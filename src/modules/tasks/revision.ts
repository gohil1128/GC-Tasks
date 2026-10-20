import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/permissions";
import { withActivityCapture } from "@/modules/notifications/context";
import { schedulePush } from "@/modules/notifications/dispatch";
import type { ActionResult, ErrorCode } from "@/modules/tasks/types";

/*
  The board revision (BoardRevision, row id = 1) and the one way a board write
  runs.

  Every write goes through boardWrite(), which opens a transaction and FIRST
  takes the revision row's lock. That makes the row the board's write lock as
  well as its change counter: two writes never interleave, so a permission
  check, a version check or a neighbour lookup made inside the transaction
  cannot be overtaken by another write before this one commits. Writes to a
  team's task board are rare and short, and serialising them is far simpler
  to reason about than per-row locks (a rebalance touches a whole column).

  The revision only goes up when the write actually changed something, so a
  no-op ("join" a task you are already on) does not send every open board to
  refetch.
*/

type Tx = Prisma.TransactionClient;

/**
  Creates the row on first use and locks it, returning the revision as it
  stands. ON CONFLICT DO UPDATE locks the row even though the update changes
  nothing, which is the point: it is the lock and the read in one statement.
*/
export async function lockBoard(tx: Tx): Promise<number> {
  const rows = await tx.$queryRaw<{ revision: number }[]>`
    INSERT INTO "BoardRevision" ("id", "revision", "updatedAt")
    VALUES (1, 0, NOW())
    ON CONFLICT ("id") DO UPDATE SET "revision" = "BoardRevision"."revision"
    RETURNING "revision"`;
  return rows[0]?.revision ?? 0;
}

/**
  One more than before. Exported for other modules whose writes change what
  the board shows (deactivating a member drops them from cards); an upsert,
  so it works with or without lockBoard() earlier in the transaction.
*/
export async function bumpRevision(tx: Tx): Promise<number> {
  const row = await tx.boardRevision.upsert({
    where: { id: 1 },
    create: { id: 1, revision: 1 },
    update: { revision: { increment: 1 } },
    select: { revision: true },
  });
  return row.revision;
}

/** The current revision, 0 before the first write. */
export async function readRevision(db: Tx | typeof prisma = prisma): Promise<number> {
  const row = await db.boardRevision.findUnique({ where: { id: 1 }, select: { revision: true } });
  return row?.revision ?? 0;
}

// ── Expected failures ──────────────────────────────────────────────────────

export type Failure = { ok: false; code: ErrorCode; error: string };

/**
  Thrown inside a board write to refuse it. Throwing (rather than returning)
  rolls the transaction back, so a refusal half-way through leaves nothing
  behind; boardWrite() turns it back into a value before it reaches a caller.
*/
export class ServiceError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function refuse(code: ErrorCode, error: string): never {
  throw new ServiceError(code, error);
}

/** A ServiceError or a known database race as a Failure; anything else is a real bug and null. */
export function asFailure(err: unknown): Failure | null {
  if (err instanceof ServiceError) return { ok: false, code: err.code, error: err.message };
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Serialization failure: somebody else's write got there first.
    if (err.code === "P2034") return CLASH;
    // A row the write depended on vanished under it.
    if (err.code === "P2025") {
      return { ok: false, code: "NOT_FOUND", error: "That was removed a moment ago. Reload to see the latest." };
    }
  }
  // A deadlock (40P01) has no Prisma code of its own: a model call reports it
  // as an unknown request error, a raw statement as P2010.
  if (
    (err instanceof Prisma.PrismaClientUnknownRequestError || err instanceof Prisma.PrismaClientKnownRequestError) &&
    /40P01|deadlock detected/i.test(err.message)
  ) {
    return CLASH;
  }
  return null;
}

const CLASH: Failure = {
  ok: false,
  code: "CONFLICT",
  error: "Someone else changed the board at the same moment. Try again.",
};

// ── Running a write ────────────────────────────────────────────────────────

export type Outcome<T> = { data: T; changed: boolean };

/** The write changed the board: bump the revision. */
export function changed<T>(data: T): Outcome<T> {
  return { data, changed: true };
}

/** Nothing needed doing (already in that state): answer without bumping. */
export function unchanged<T>(data: T): Outcome<T> {
  return { data, changed: false };
}

/*
  The acting person as they stand now, read under the board lock.

  requireUser() read them at the start of the request, but a write can queue
  behind another for a moment — behind the very deactivation or demotion of
  the person making it. Checked against that earlier read, a join that waited
  behind a deactivation would put a switched-off account on a card, and an
  owner demoted mid-request would still finish an owner's action. Read here,
  after the lock, nothing that commits ahead of this write can be missed.
*/
async function freshActor(tx: Tx, actor: Actor): Promise<Actor> {
  const row = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true } });
  if (!row || !row.active) refuse("UNAUTHORIZED", "Your account is no longer active.");
  return { id: actor.id, role: row.role };
}

/**
  Runs `work` as one board write: lock, work, bump. Expected failures come
  back as { ok:false }; anything else is rethrown, because a write that broke
  in a way nobody planned for should fail loudly, not as a toast.

  Given the acting person, it re-reads them once the lock is held and hands
  `work` that fresh copy, which every permission check inside should use.
*/
export async function boardWrite<T>(work: (tx: Tx) => Promise<Outcome<T>>): Promise<ActionResult<T>>;
export async function boardWrite<T>(
  actor: Actor,
  work: (tx: Tx, actor: Actor) => Promise<Outcome<T>>,
): Promise<ActionResult<T>>;
export async function boardWrite<T>(
  ...args: [(tx: Tx) => Promise<Outcome<T>>] | [Actor, (tx: Tx, actor: Actor) => Promise<Outcome<T>>]
): Promise<ActionResult<T>> {
  try {
    // The capture store rides along inside the transaction: log() drops a
    // copy of every activity it writes into it, and only a COMMITTED write
    // gets its copies back here — so a rolled-back write never announces
    // itself, and the push goes out after the commit, not inside it.
    const { result, entries } = await withActivityCapture(() =>
      prisma.$transaction(
        async (tx) => {
          const before = await lockBoard(tx);
          const out = args.length === 1 ? await args[0](tx) : await args[1](tx, await freshActor(tx, args[0]));
          const revision = out.changed ? await bumpRevision(tx) : before;
          return { ok: true as const, data: out.data, revision };
        },
        // Writes queue on the board lock, so allow for waiting behind a few.
        { maxWait: 5_000, timeout: 15_000 },
      ),
    );
    if (result.ok) schedulePush(entries);
    return result;
  } catch (err) {
    const failure = asFailure(err);
    if (failure) return failure;
    throw err;
  }
}
