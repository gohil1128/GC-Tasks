import { Prisma, type MailConnection, type PrismaClient } from "@prisma/client";
import { parseDay } from "@/lib/dates";
import type { Actor } from "@/lib/permissions";
import { createLabel } from "@/modules/labels/service";
import { addComment, createTask } from "@/modules/tasks/service";
import { ClassifyRefused, type EmailClassifier, type Verdict } from "./classify";
import {
  CONCURRENCY,
  CONFIDENCE_MIN,
  EMAIL_LABEL,
  MAX_ATTEMPTS,
  MAX_LOOKBACK_DAYS,
  MAX_MESSAGES_PER_RUN,
  MAX_TASKS_PER_RUN,
  OVERLAP_HOURS,
  RUN_BUDGET_MS,
  RUN_LOCK_MS,
  SCAN_TIME_ZONE,
  SKIPPED_RETENTION_DAYS,
} from "./config";
import { buildScanQuery, GmailAuthError, type MailClient, type MailItem } from "./gmail";
import { dayIn } from "./schedule";

/*
  One scan of the connected mailbox.

  1. Ask Gmail for the messages in the window it has not filed as noise.
  2. Drop every id the ledger has already seen. Free, and it is what makes
     re-reading the last few hours on every run safe.
  3. For each remaining message, OLDEST FIRST, claim it in the ledger before
     touching it. The unique (mailbox, gmail id) key means two scans that
     overlap — the nightly one and a "Scan now" — cannot both read one email.
  4. The model reads sender, subject, body and attachment names, and says
     whether it asks for something to be done.
  5. Nothing to do → only the bare Gmail id is kept. Something to do → a task
     in To do, assigned to the owner who connected the mailbox, labelled
     "Email", with a link back to the email. A later email in the same thread
     (a reminder, a follow-up) adds a comment to that task instead of a second
     task, while the task is still open.

  Oldest-first is what lets the cursor be honest: if the run stops on its time
  budget, everything before the cursor really has been handled.
*/

export type ScanDeps = {
  db: PrismaClient;
  mailFor: (connection: MailConnection) => Promise<MailClient>;
  classifier: EmailClassifier;
  now?: () => Date;
};

export type ScanResult = {
  ran: boolean;
  /** Why it did not run, when it did not. */
  note?: string;
  listed: number;
  read: number;
  tasks: number;
  comments: number;
  skipped: number;
  failed: number;
  partial: boolean;
  error?: string;
};

const empty = (): ScanResult => ({
  ran: false, listed: 0, read: 0, tasks: 0, comments: 0, skipped: 0, failed: 0, partial: false,
});

const brief = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 200);

/** The owner who connected the mailbox can no longer create tasks. */
class OwnerGone extends Error {}

export async function scanMailbox(trigger: "nightly" | "manual", deps: ScanDeps): Promise<ScanResult> {
  const { db, classifier } = deps;
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const result = empty();

  const connection = await db.mailConnection.findUnique({ where: { id: 1 } });
  if (!connection) return { ...result, note: "No mailbox is connected." };
  if (connection.status !== "ACTIVE") return { ...result, note: connection.statusNote ?? "The mailbox needs to be reconnected." };

  const owner = await db.user.findUnique({
    where: { id: connection.connectedById },
    select: { id: true, name: true, role: true, active: true },
  });
  if (!owner || !owner.active || owner.role !== "OWNER") {
    await markReconnect(db, ownerGoneNote(owner?.name));
    return { ...result, note: ownerGoneNote(owner?.name) };
  }
  const actor: Actor = { id: owner.id, role: owner.role };

  // A run that never finished (the function was killed) stops counting after
  // RUN_LOCK_MS, so one crash cannot switch the scanner off for good.
  await db.mailScanRun.updateMany({
    where: { finishedAt: null, startedAt: { lt: new Date(startedAt.getTime() - RUN_LOCK_MS) } },
    data: { finishedAt: startedAt, error: "Timed out." },
  });
  if (await db.mailScanRun.findFirst({ where: { finishedAt: null }, select: { id: true } })) {
    return { ...result, note: "A scan is already running." };
  }

  const run = await db.mailScanRun.create({ data: { trigger, startedAt }, select: { id: true } });
  const finish = async (patch: Partial<ScanResult>, cursor?: Date) => {
    Object.assign(result, patch, { ran: true });
    await db.mailScanRun.update({
      where: { id: run.id },
      data: {
        finishedAt: now(), listed: result.listed, read: result.read, tasks: result.tasks,
        comments: result.comments, skipped: result.skipped, failed: result.failed,
        partial: result.partial, error: result.error ?? null,
      },
    });
    await db.mailConnection.updateMany({
      where: { id: 1, accountEmail: connection.accountEmail },
      data: {
        lastScanAt: now(),
        // Never backwards, and only as far as mail has really been handled.
        ...(cursor && cursor > connection.scannedThrough ? { scannedThrough: cursor } : {}),
      },
    });
    return result;
  };

  let mail: MailClient;
  try {
    mail = await deps.mailFor(connection);
  } catch (e) {
    if (e instanceof GmailAuthError) await markReconnect(db, "Google no longer accepts this connection. Connect the mailbox again.");
    return finish({ error: brief(e) });
  }

  try {
    const windowStart = new Date(connection.scannedThrough.getTime() - OVERLAP_HOURS * 3_600_000);
    // A mailbox left unscanned for weeks does not go back and read all of it.
    const floor = new Date(startedAt.getTime() - MAX_LOOKBACK_DAYS * 86_400_000);
    const ids = (await mail.listIds(buildScanQuery(windowStart > floor ? windowStart : floor), 500)).reverse();
    result.listed = ids.length;

    const account = connection.accountEmail;
    const seen = await db.mailMessage.findMany({
      where: { accountEmail: account, gmailId: { in: ids } },
      select: { gmailId: true, status: true, attempts: true, updatedAt: true },
    });
    const seenById = new Map(seen.map((m) => [m.gmailId, m]));
    const retryAfter = new Date(startedAt.getTime() - RUN_LOCK_MS);
    const todo = ids.filter((id) => {
      const s = seenById.get(id);
      if (!s) return true;
      // A failed email is tried again on later scans, a few times, never in a
      // tight loop and never forever.
      return s.status === "FAILED" && s.attempts < MAX_ATTEMPTS && s.updatedAt < retryAfter;
    });

    const ctx: Ctx = {
      db, mail, classifier, actor, account,
      today: dayIn(SCAN_TIME_ZONE, startedAt),
      labelId: null,
      tasksMade: 0,
    };

    /*
      In batches, oldest first. The cursor may move up to the end of the
      longest run of handled emails from the start: a failure stops it there,
      so the email that failed is listed (and retried) again next time.
    */
    const slate = todo.slice(0, MAX_MESSAGES_PER_RUN);
    let cursor: Date | null = null;
    let prefixIntact = true;
    let started = 0;
    for (let i = 0; i < slate.length; i += CONCURRENCY) {
      if (ctx.tasksMade >= MAX_TASKS_PER_RUN || now().getTime() - startedAt.getTime() > RUN_BUDGET_MS) break;
      const batch = slate.slice(i, i + CONCURRENCY);
      started += batch.length;
      const outcomes = await runBatch(ctx, batch, seenById);
      for (const o of outcomes) {
        if (o instanceof OwnerGone || o instanceof GmailAuthError) throw o;
        if (o === "busy") {
          prefixIntact = false;
        } else if (o instanceof Error) {
          result.failed++;
          prefixIntact = false;
        } else {
          result.read++;
          result[o.counter]++;
          if (prefixIntact) cursor = o.receivedAt;
        }
      }
    }
    const exhausted = started < todo.length;

    result.partial = exhausted || ids.length >= 500;
    await db.mailMessage.deleteMany({
      where: {
        accountEmail: account,
        status: "SKIPPED",
        createdAt: { lt: new Date(startedAt.getTime() - SKIPPED_RETENTION_DAYS * 86_400_000) },
      },
    });
    // Everything listed was handled cleanly → the cursor jumps to where this
    // run began. Otherwise it stops at the last email handled in order.
    const clean = !result.partial && prefixIntact;
    return finish({}, clean ? startedAt : (cursor ?? undefined));
  } catch (e) {
    if (e instanceof GmailAuthError) {
      await markReconnect(db, "Google no longer accepts this connection. Connect the mailbox again.");
    } else if (e instanceof OwnerGone) {
      await markReconnect(db, e.message);
    }
    return finish({ error: brief(e) });
  }
}

function ownerGoneNote(name: string | undefined): string {
  return `${name ?? "The owner who connected it"} can no longer create tasks. An owner needs to connect the mailbox again.`;
}

async function markReconnect(db: PrismaClient, note: string) {
  await db.mailConnection.updateMany({ where: { id: 1 }, data: { status: "NEEDS_RECONNECT", statusNote: note } });
}

/** Create the ledger row, or take over a retryable one. Null = somebody else has it. */
async function claim(db: PrismaClient, accountEmail: string, gmailId: string, retry: boolean): Promise<string | null> {
  if (retry) {
    const row = await db.mailMessage.update({
      where: { accountEmail_gmailId: { accountEmail, gmailId } },
      data: { attempts: { increment: 1 }, reason: "Processing." },
      select: { id: true },
    });
    return row.id;
  }
  try {
    const row = await db.mailMessage.create({
      data: { accountEmail, gmailId, receivedAt: new Date(), status: "FAILED", reason: "Processing.", attempts: 1 },
      select: { id: true },
    });
    return row.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
}

type Ctx = {
  db: PrismaClient;
  mail: MailClient;
  classifier: EmailClassifier;
  actor: Actor;
  account: string;
  today: string;
  labelId: Promise<string | null> | null;
  tasksMade: number;
};

type Outcome = { counter: "tasks" | "comments" | "skipped"; receivedAt: Date };

/*
  One batch: claim and fetch in parallel, then handle. Emails of the same
  thread are handled one after another, oldest first, so a reminder that
  arrives with its original finds the original's task and comments on it
  instead of racing it to make a second one.
*/
async function runBatch(
  ctx: Ctx,
  batch: string[],
  seenById: Map<string, unknown>,
): Promise<Array<Outcome | "busy" | Error>> {
  const { db } = ctx;
  const failed = async (rowId: string, e: unknown) => {
    await db.mailMessage.update({ where: { id: rowId }, data: { status: "FAILED", reason: brief(e) } });
    return e instanceof Error ? e : new Error(String(e));
  };
  type Fetched = { done: "busy" | Error } | { rowId: string; item: MailItem };
  const fetched = await Promise.all(
    batch.map(async (id): Promise<Fetched> => {
      const rowId = await claim(db, ctx.account, id, seenById.has(id));
      if (!rowId) return { done: "busy" }; // another scan has it
      try {
        return { rowId, item: await ctx.mail.get(id) };
      } catch (e) {
        return { done: await failed(rowId, e) };
      }
    }),
  );
  const out: Array<Outcome | "busy" | Error> = fetched.map((f) => ("done" in f ? f.done : new Error("Not handled.")));
  const threads = new Map<string, number[]>();
  fetched.forEach((f, i) => {
    if (!("done" in f)) threads.set(f.item.threadId, [...(threads.get(f.item.threadId) ?? []), i]);
  });
  await Promise.all(
    [...threads.values()].map(async (indexes) => {
      for (const i of indexes) {
        const f = fetched[i] as { rowId: string; item: MailItem };
        try {
          out[i] = await handleOne(ctx, f.item, f.rowId);
        } catch (e) {
          out[i] = await failed(f.rowId, e);
        }
      }
    }),
  );
  return out;
}

async function handleOne(ctx: Ctx, item: MailItem, rowId: string): Promise<Outcome> {
  const { db } = ctx;

  const skip = async (reason: string | null = null): Promise<Outcome> => {
    // Only the bare id is kept — no sender, no subject — so a mailbox of
    // ordinary mail leaves nothing identifying behind.
    await db.mailMessage.update({
      where: { id: rowId },
      data: { status: "SKIPPED", receivedAt: item.receivedAt, threadId: item.threadId, reason },
    });
    return { counter: "skipped", receivedAt: item.receivedAt };
  };

  let verdict: Verdict;
  try {
    verdict = await ctx.classifier.classify({
      fromAddress: item.fromAddress,
      fromName: item.fromName,
      subject: item.subject,
      receivedAt: item.receivedAt,
      text: item.text,
      attachmentNames: item.attachments.map((f) => f.filename),
      mailbox: ctx.account,
      today: ctx.today,
    });
  } catch (e) {
    if (e instanceof ClassifyRefused) return skip("The AI declined to read this email.");
    throw e;
  }

  const task = toTaskInput(verdict, item, ctx);
  if (!task) return skip();

  // A reminder or follow-up on a thread that already has an open task goes on
  // that task, not into a second one.
  const earlier = await db.mailMessage.findFirst({
    where: {
      accountEmail: ctx.account,
      threadId: item.threadId,
      status: "TASK",
      task: { archivedAt: null, status: { not: "DONE" } },
    },
    orderBy: { createdAt: "desc" },
    select: { taskId: true },
  });
  if (earlier?.taskId) {
    const commented = await addComment(ctx.actor, { taskId: earlier.taskId, body: task.comment });
    if (commented.ok) {
      await db.mailMessage.update({
        where: { id: rowId },
        data: { status: "TASK", taskId: earlier.taskId, receivedAt: item.receivedAt, threadId: item.threadId, reason: "Added to the thread's task." },
      });
      return { counter: "comments", receivedAt: item.receivedAt };
    }
    if (commented.code === "UNAUTHORIZED" || commented.code === "FORBIDDEN") throw new OwnerGone(ownerGoneNote(undefined));
    // Otherwise (deleted a moment ago, say) it gets a task of its own.
  }

  const labelId = await emailLabel(ctx);
  const made = await createTask(ctx.actor, {
    title: task.title,
    description: task.description,
    status: "TODO",
    priority: task.priority,
    dueDate: task.dueDate,
    assigneeIds: [ctx.actor.id],
    labelIds: labelId ? [labelId] : [],
  });
  if (!made.ok) {
    if (made.code === "UNAUTHORIZED" || made.code === "FORBIDDEN") throw new OwnerGone(ownerGoneNote(undefined));
    throw new Error(made.error);
  }
  ctx.tasksMade++;
  await db.mailMessage.update({
    where: { id: rowId },
    data: { status: "TASK", taskId: made.data.id, receivedAt: item.receivedAt, threadId: item.threadId, reason: null },
  });
  return { counter: "tasks", receivedAt: item.receivedAt };
}

/** The "Email" label's id, created the first time it is needed; shared by a run's parallel emails. */
function emailLabel(ctx: Ctx): Promise<string | null> {
  ctx.labelId ??= (async () => {
    const find = async () =>
      (
        await ctx.db.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Label" WHERE lower("name") = lower(${EMAIL_LABEL.name}) LIMIT 1`
      )[0]?.id ?? null;
    const existing = await find();
    if (existing) return existing;
    const made = await createLabel(ctx.actor, { name: EMAIL_LABEL.name, color: EMAIL_LABEL.color });
    // Lost a race with a person creating it by hand: use theirs. Anything else:
    // carry on without a label rather than fail the email.
    return made.ok ? made.data.id : await find();
  })();
  return ctx.labelId;
}

const GMAIL_LINK = (account: string, id: string) =>
  `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${id}`;

/*
  What the model said, turned into a task by plain code. Lengths are bounded,
  the due date must be a real day near the email (not "1970-01-01" or ten
  years out), the priority is decided here from the due date — never by the
  model — and anything doubtful is said at the top of the description.
  Null = nothing to do.
*/
export function toTaskInput(
  v: Verdict,
  item: Pick<MailItem, "id" | "fromAddress" | "fromName" | "subject" | "receivedAt" | "authenticated" | "attachments">,
  ctx: Pick<Ctx, "account" | "today">,
): {
  title: string;
  description: string;
  comment: string;
  dueDate: Date | null;
  priority: "MEDIUM" | "HIGH";
} | null {
  if (!v.action_needed) return null;
  if (!Number.isFinite(v.confidence) || v.confidence < CONFIDENCE_MIN) return null;

  const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  const clean = (s: string) => s.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

  const title = cut(oneLine(v.title) || oneLine(item.subject) || "Email needs a reply", 120);
  const details = cut(clean(v.details), 2_000);

  let dueDate: Date | null = null;
  const day = v.due_date ? parseDay(v.due_date) : null;
  if (day) {
    const received = Date.UTC(item.receivedAt.getUTCFullYear(), item.receivedAt.getUTCMonth(), item.receivedAt.getUTCDate());
    const days = (day.getTime() - received) / 86_400_000;
    // An overdue date the email itself states (a reminder) is kept; nonsense is not.
    if (days >= -60 && days <= 730) dueDate = day;
  }
  const todayMs = parseDay(ctx.today)?.getTime() ?? Date.now();
  const priority = dueDate && dueDate.getTime() - todayMs <= 2 * 86_400_000 ? "HIGH" : "MEDIUM";

  const warnings: string[] = [];
  if (v.suspicious) warnings.push("⚠ This email looks suspicious. Check it is genuine before you act on it.");
  if (!item.authenticated) {
    warnings.push(`⚠ Gmail could not confirm this really came from ${item.fromAddress || "the sender"}.`);
  }

  const from = item.fromName ? `${oneLine(item.fromName)} <${item.fromAddress}>` : item.fromAddress;
  const source = [
    `From: ${cut(from, 200)}`,
    `Subject: ${cut(oneLine(item.subject) || "(no subject)", 300)}`,
    `Received: ${item.receivedAt.toISOString().slice(0, 10)}`,
    ...(item.attachments.length ? [`Attachments: ${cut(item.attachments.map((a) => oneLine(a.filename)).join(", "), 400)}`] : []),
    `Open the email: ${GMAIL_LINK(ctx.account, item.id)}`,
  ].join("\n");

  const description = cut([warnings.join("\n"), details, source].filter(Boolean).join("\n\n"), 9_000);
  const comment = cut(
    [
      `Another email on this: ${title}`,
      warnings.join("\n"),
      details,
      `From ${cut(from, 200)}, ${item.receivedAt.toISOString().slice(0, 10)}. ${GMAIL_LINK(ctx.account, item.id)}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    4_500,
  );
  return { title, description, comment, dueDate, priority };
}
