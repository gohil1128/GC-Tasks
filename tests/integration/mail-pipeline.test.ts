import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import type { EmailClassifier, Verdict } from "@/modules/mail/classify";
import type { MailClient, MailItem } from "@/modules/mail/gmail";
import { GmailAuthError } from "@/modules/mail/gmail";
import { scanMailbox, type ScanDeps } from "@/modules/mail/pipeline";
import { runNightly } from "@/modules/mail/service";
import type { EmailTaskEvent } from "@/modules/notifications/dispatch";

/*
  The whole scan against a real Postgres, with a fake mailbox and a fake
  model: no email is read and no AI is called. Empties every table between
  tests, so it only runs against a database whose URL says it is a test one.
*/

const url = process.env.DATABASE_URL ?? "";
const enabled = url.includes("test");
const ACCOUNT = "sip@godschai.example";

async function reset() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "MailMessage", "MailScanRun", "MailConnection", "Activity", "Comment", "ChecklistItem", "TaskLabel", "TaskAssignee", "Task", "Label", "BoardRevision", "User" RESTART IDENTITY CASCADE`,
  );
}

function email(id: string, over: Partial<MailItem> = {}): MailItem {
  return {
    id,
    threadId: `t-${id}`,
    fromAddress: "forms@city.example",
    fromName: "City Permits",
    subject: `Subject ${id}`,
    receivedAt: new Date(`2026-11-07T1${id.length % 10}:00:00Z`),
    authenticated: true,
    text: `Body of ${id}`,
    attachments: [],
    ...over,
  };
}

function fakeMail(items: MailItem[], calls: { get: string[] } = { get: [] }): MailClient {
  const byId = new Map(items.map((m) => [m.id, m]));
  return {
    // Gmail lists newest first.
    async listIds() {
      return [...items].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()).map((m) => m.id);
    },
    async get(id) {
      calls.get.push(id);
      const m = byId.get(id);
      if (!m) throw new Error("no such message");
      return m;
    },
    async attachment() {
      return Buffer.alloc(0);
    },
  };
}

const ACTION: Verdict = {
  action_needed: true,
  kind: "form",
  title: "Complete the food permit renewal form",
  details: "The city asks for the renewal form by the 20th.",
  due_date: "2026-11-20",
  confidence: 0.92,
  suspicious: false,
};
const NOTHING: Verdict = { ...ACTION, action_needed: false, title: "", details: "", due_date: null };

/** Decides by subject: "ACT" in it needs doing, "BOOM" throws. */
const classifier: EmailClassifier = {
  async classify(e) {
    if (e.subject.includes("BOOM")) throw new Error("model unavailable");
    return e.subject.includes("ACT") ? { ...ACTION, title: `Do ${e.subject}` } : NOTHING;
  },
};

describe.skipIf(!enabled)("email to tasks (integration)", () => {
  let ownerId: string;
  let staffId: string;
  let pushed: EmailTaskEvent[];

  beforeEach(async () => {
    await reset();
    pushed = [];
    ownerId = (await prisma.user.create({ data: { email: "o@x.test", name: "Ola", role: "OWNER", passwordHash: "x" } })).id;
    staffId = (await prisma.user.create({ data: { email: "s@x.test", name: "Sam", role: "STAFF", passwordHash: "x" } })).id;
    await prisma.mailConnection.create({
      data: {
        id: 1,
        accountEmail: ACCOUNT,
        refreshTokenEnc: "v1.not-used-by-the-fake",
        scope: "gmail.readonly",
        connectedById: ownerId,
        scannedThrough: new Date("2026-11-05T00:00:00Z"),
      },
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const deps = (items: MailItem[], extra: Partial<ScanDeps> = {}): ScanDeps => ({
    db: prisma,
    mailFor: async () => fakeMail(items),
    classifier,
    now: () => new Date("2026-11-08T06:10:00Z"),
    notify: (e) => pushed.push(e),
    ...extra,
  });

  it("turns only the emails that ask for something into tasks, assigned to the owner and labelled Email", async () => {
    const items = [email("a", { subject: "ACT sign LOA" }), email("bb", { subject: "Weekly newsletter" }), email("ccc", { subject: "ACT permit" })];
    const r = await scanMailbox("manual", deps(items));
    expect(r).toMatchObject({ ran: true, listed: 3, read: 3, tasks: 2, skipped: 1, failed: 0, partial: false });

    const tasks = await prisma.task.findMany({
      include: { assignees: true, labels: { include: { label: true } } },
      orderBy: { createdAt: "asc" },
    });
    expect(tasks.map((t) => t.title).sort()).toEqual(["Do ACT permit", "Do ACT sign LOA"]);
    for (const t of tasks) {
      expect(t.status).toBe("TODO");
      expect(t.createdById).toBe(ownerId);
      expect(t.assignees.map((a) => a.userId)).toEqual([ownerId]);
      expect(t.labels.map((l) => l.label.name)).toEqual(["Email"]);
      expect(t.dueDate?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
      expect(t.description).toContain(`authuser=${encodeURIComponent(ACCOUNT)}`);
    }
    // One label, however many emails needed it at once.
    expect(await prisma.label.count()).toBe(1);
    // Staff were not involved.
    expect(await prisma.taskAssignee.count({ where: { userId: staffId } })).toBe(0);

    // The skipped email left only its id behind.
    const skipped = await prisma.mailMessage.findFirstOrThrow({ where: { gmailId: "bb" } });
    expect(skipped).toMatchObject({ status: "SKIPPED", taskId: null, reason: null });

    // Cursor moves to where the run began.
    const c = await prisma.mailConnection.findUniqueOrThrow({ where: { id: 1 } });
    expect(c.scannedThrough.toISOString()).toBe("2026-11-08T06:10:00.000Z");
  });

  it("never reads an email twice, and never makes a second task from it", async () => {
    const calls = { get: [] as string[] };
    const items = [email("a", { subject: "ACT one" })];
    const d = deps(items, { mailFor: async () => fakeMail(items, calls) });
    await scanMailbox("nightly", d);
    const again = await scanMailbox("manual", d);
    expect(again).toMatchObject({ listed: 1, read: 0, tasks: 0 });
    expect(calls.get).toEqual(["a"]);
    expect(await prisma.task.count()).toBe(1);
  });

  it("does not make tasks again after the mailbox is disconnected and connected again", async () => {
    const items = [email("a", { subject: "ACT one" })];
    await scanMailbox("manual", deps(items));
    const row = await prisma.mailConnection.findUniqueOrThrow({ where: { id: 1 } });
    await prisma.mailConnection.delete({ where: { id: 1 } });
    await prisma.mailConnection.create({ data: { ...row, scannedThrough: new Date("2026-11-05T00:00:00Z") } });
    expect(await scanMailbox("manual", deps(items))).toMatchObject({ read: 0, tasks: 0 });
    expect(await prisma.task.count()).toBe(1);
  });

  it("puts a follow-up in the same thread on the open task as a comment", async () => {
    const first = email("a", { subject: "ACT sign LOA", threadId: "T1", receivedAt: new Date("2026-11-06T10:00:00Z") });
    const reminder = email("bb", { subject: "ACT reminder: sign LOA", threadId: "T1", receivedAt: new Date("2026-11-07T10:00:00Z") });
    const r = await scanMailbox("manual", deps([first, reminder]));
    expect(r).toMatchObject({ tasks: 1, comments: 1 });
    const task = await prisma.task.findFirstOrThrow({ include: { comments: true } });
    expect(task.title).toBe("Do ACT sign LOA");
    expect(task.comments).toHaveLength(1);
    expect(task.comments[0].body).toContain("Another email on this");
    // Owners' devices hear of the task, then of the follow-up on it.
    expect(pushed).toEqual([
      { taskId: task.id, title: "Do ACT sign LOA", kind: "task", doubtful: false },
      { taskId: task.id, title: "Do ACT reminder: sign LOA", kind: "update", doubtful: false },
    ]);
  });

  it("announces each new task once, flags doubtful ones, and says nothing about skipped mail", async () => {
    const items = [
      email("a", { subject: "ACT sign LOA", authenticated: false }),
      email("bb", { subject: "Newsletter" }),
      email("ccc", { subject: "ACT permit" }),
    ];
    await scanMailbox("manual", deps(items));
    expect(pushed.map((p) => [p.title, p.kind, p.doubtful]).sort()).toEqual([
      ["Do ACT permit", "task", false],
      ["Do ACT sign LOA", "task", true],
    ]);
    const ids = (await prisma.task.findMany({ select: { id: true } })).map((t) => t.id).sort();
    expect(pushed.map((p) => p.taskId).sort()).toEqual(ids);
    // Reading the same mail again announces nothing.
    pushed = [];
    await scanMailbox("manual", deps(items));
    expect(pushed).toEqual([]);
  });

  it("a follow-up on a thread whose task is done gets a new task", async () => {
    const first = email("a", { subject: "ACT one", threadId: "T1", receivedAt: new Date("2026-11-06T10:00:00Z") });
    await scanMailbox("manual", deps([first]));
    await prisma.task.updateMany({ data: { status: "DONE" } });
    const later = email("bb", { subject: "ACT two", threadId: "T1", receivedAt: new Date("2026-11-07T10:00:00Z") });
    expect(await scanMailbox("manual", deps([first, later]))).toMatchObject({ tasks: 1, comments: 0 });
    expect(await prisma.task.count()).toBe(2);
  });

  it("a failure is recorded, does not stop the rest, and holds the cursor back so it is retried", async () => {
    const items = [
      email("a", { subject: "ACT first", receivedAt: new Date("2026-11-06T10:00:00Z") }),
      email("bb", { subject: "BOOM", receivedAt: new Date("2026-11-06T11:00:00Z") }),
      email("ccc", { subject: "ACT third", receivedAt: new Date("2026-11-06T12:00:00Z") }),
    ];
    const r = await scanMailbox("manual", deps(items));
    expect(r).toMatchObject({ read: 2, tasks: 2, failed: 1 });
    const failed = await prisma.mailMessage.findFirstOrThrow({ where: { gmailId: "bb" } });
    expect(failed).toMatchObject({ status: "FAILED", attempts: 1, reason: "model unavailable" });
    const c = await prisma.mailConnection.findUniqueOrThrow({ where: { id: 1 } });
    // Up to the last email handled before the failure, not past it.
    expect(c.scannedThrough.toISOString()).toBe("2026-11-06T10:00:00.000Z");
  });

  it("marks the mailbox for reconnecting when Google stops accepting it", async () => {
    const r = await scanMailbox("manual", deps([], { mailFor: async () => { throw new GmailAuthError("revoked"); } }));
    expect(r.error).toBe("revoked");
    const c = await prisma.mailConnection.findUniqueOrThrow({ where: { id: 1 } });
    expect(c.status).toBe("NEEDS_RECONNECT");
    expect(await scanMailbox("manual", deps([]))).toMatchObject({ ran: false });
  });

  it("stops, and says so, when the owner who connected it is no longer an owner", async () => {
    await prisma.user.update({ where: { id: ownerId }, data: { role: "STAFF" } });
    const r = await scanMailbox("manual", deps([email("a", { subject: "ACT one" })]));
    expect(r.ran).toBe(false);
    expect(r.note).toContain("Ola can no longer create tasks");
    expect(await prisma.task.count()).toBe(0);
    expect((await prisma.mailConnection.findUniqueOrThrow({ where: { id: 1 } })).status).toBe("NEEDS_RECONNECT");
  });

  it("only one scan runs at a time", async () => {
    await prisma.mailScanRun.create({ data: { trigger: "manual", startedAt: new Date("2026-11-08T06:05:00Z") } });
    expect(await scanMailbox("manual", deps([email("a", { subject: "ACT one" })]))).toMatchObject({
      ran: false,
      note: "A scan is already running.",
    });
  });

  it("the nightly entry runs once per Winnipeg night", async () => {
    const d = deps([email("a", { subject: "ACT one" })]);
    // 00:10 in Winnipeg (year-round UTC-5 since November 2026).
    const midnight = new Date("2026-11-08T05:10:00Z");
    const first = await runNightly(d, midnight);
    expect(first).toMatchObject({ ran: true, decision: "nightly", tasks: 1 });
    const second = await runNightly(d, new Date("2026-11-08T05:40:00Z"));
    expect(second).toMatchObject({ ran: false, decision: "skip" });
    // 2:30 a.m. is not midnight, even for a night not yet scanned.
    await prisma.mailConnection.update({ where: { id: 1 }, data: { nightlyDate: null } });
    expect(await runNightly(d, new Date("2026-11-08T07:30:00Z"))).toMatchObject({ ran: false });
    expect((await prisma.mailConnection.findUniqueOrThrow({ where: { id: 1 } })).nightlyDate).toBeNull();
  });
});
