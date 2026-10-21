import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { colorForSeed } from "@/lib/colors";
import { canManageTeam, type Actor } from "@/lib/permissions";
import { generatePassword, hashPassword } from "@/modules/auth/password";
import { loginKeys } from "@/modules/auth/rate-limit";
import { bumpRevision, lockBoard, readRevision } from "@/modules/tasks/revision";
import type { ActionResult, ErrorCode, Member } from "@/modules/tasks/types";
import {
  activeSchema,
  addMemberSchema,
  firstIssue,
  memberIdSchema,
  profileSchema,
  roleSchema,
} from "@/modules/team/schemas";
import type { TeamMember } from "@/modules/team/types";

/*
  Running the team: adding people, resetting their passwords, switching them
  off and on, and deciding who is an owner.

  Written against an Actor rather than the session so it can be called — and
  tested — without a request; the Server Actions in ./actions.ts authenticate
  and then hand over. Everything returns an ActionResult and nothing throws
  for an expected refusal.

  The rule that matters most here is that the board is never left without an
  active owner, because nobody else can add people, reset passwords or undo a
  mistake. Each change that could break it is decided inside one transaction
  that first takes a team-wide lock and re-reads the acting owner. Without the
  lock, two owners demoting each other at the same moment would each see the
  other still in charge, both succeed, and leave nobody.
*/

type Tx = Prisma.TransactionClient;

/** Arbitrary, but fixed: every change to who is on the team takes this lock. */
const TEAM_LOCK_KEY = 7_340_021;

const NOT_OWNER = "Only owners can manage the team.";
const NOT_FOUND = "That teammate could not be found. They may have been removed — refresh and try again.";
const EMAIL_TAKEN = "Someone on the team already uses that email address.";
const CLASHED = "Someone else changed the team at the same moment. Try again.";

/** An expected refusal, thrown inside a transaction so it rolls back, then returned. */
class Refusal extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "Refusal";
  }
}

function fail<T>(code: ErrorCode, error: string): ActionResult<T> {
  return { ok: false, code, error };
}

/** Prisma's error for a unique index — here, two people racing to the same email. */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/*
  Postgres broke a lock cycle (40P01) or refused a serialization (P2034).
  Prisma has no code of its own for a deadlock: it arrives as P2010 from a
  raw statement such as the board lock and untyped from anything else, with
  Postgres's code only in the message. Every write here takes its locks in
  one order, so this should not happen; if it does, the other change won and
  this one can simply be tried again. Returned as INVALID rather than
  CONFLICT because runAction() leaves CONFLICT for the caller to show, and
  nothing on the Team or Settings page does: the click would fail in silence.
*/
function isLockClash(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") return true;
  const fromDatabase =
    err instanceof Prisma.PrismaClientKnownRequestError || err instanceof Prisma.PrismaClientUnknownRequestError;
  return fromDatabase && /40P01|deadlock detected/.test(err.message);
}

function settle<T>(err: unknown): ActionResult<T> {
  if (err instanceof Refusal) return fail(err.code, err.message);
  if (isUniqueViolation(err)) return fail("INVALID", EMAIL_TAKEN);
  if (isLockClash(err)) return fail("INVALID", CLASHED);
  throw err;
}

const memberSelect = {
  id: true,
  name: true,
  email: true,
  color: true,
  avatar: true,
  role: true,
  active: true,
} satisfies Prisma.UserSelect;

type MemberRow = Prisma.UserGetPayload<{ select: typeof memberSelect }>;

export function toMember(row: MemberRow): Member {
  return { id: row.id, name: row.name, email: row.email, color: row.color, avatar: row.avatar, role: row.role, active: row.active };
}

/*
  Serialises every change to the team; both locks are released when the
  transaction ends.

  The board's own write lock is taken second, straight away, rather than
  left to the revision bump at the end. Task writes take that lock FIRST and
  then touch assignment rows; a team change that touched assignment rows
  (deactivating someone drops them from every card) and only then reached
  for the board lock would hold what a task write wants while wanting what
  it holds — a deadlock. Taking it up front keeps one order everywhere:
  team lock, board lock, rows.
*/
export async function lockTeam(tx: Tx): Promise<void> {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${TEAM_LOCK_KEY})`);
  await lockBoard(tx);
}

export { bumpRevision };

/*
  The session said owner when the request started; this asks the database
  again, under the lock, so an owner demoted or switched off a moment ago
  cannot finish what they started.
*/
async function assertStillOwner(tx: Tx, actor: Actor): Promise<void> {
  const row = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true } });
  if (!row || !row.active || row.role !== "OWNER") throw new Refusal("FORBIDDEN", NOT_OWNER);
}

async function findTarget(tx: Tx, id: string) {
  const row = await tx.user.findUnique({ where: { id }, select: memberSelect });
  if (!row) throw new Refusal("NOT_FOUND", NOT_FOUND);
  return row;
}

async function otherActiveOwners(tx: Tx, excludingId: string): Promise<number> {
  return tx.user.count({ where: { role: "OWNER", active: true, id: { not: excludingId } } });
}

/**
  Emails are stored lowercased, but an address written in by hand (or by an
  older script) might not be, so the duplicate check ignores case too. It
  compares lower() to lower() rather than using Prisma's insensitive mode,
  which is ILIKE and reads an _ in the address as "any character".
*/
async function emailInUse(tx: Tx, email: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "User" WHERE lower("email") = lower(${email}) LIMIT 1`;
  return rows.length > 0;
}

/*
  Coming off a card this way is a change to what it says, as much as an
  owner unassigning them by hand: the version moves, so someone with the card
  open is told and re-merges rather than having their save refused for
  "assigning" a deactivated person they never picked, and its history says
  who took them off. Under the board lock, so no write can add them back
  between the read and the delete.
*/
async function unassignEverywhere(tx: Tx, actor: Actor, userId: string): Promise<void> {
  const rows = await tx.taskAssignee.findMany({ where: { userId }, select: { taskId: true } });
  if (rows.length === 0) return;
  const taskIds = rows.map((r) => r.taskId);
  await tx.taskAssignee.deleteMany({ where: { userId } });
  await tx.task.updateMany({
    where: { id: { in: taskIds } },
    data: { version: { increment: 1 }, updatedById: actor.id },
  });
  await tx.activity.createMany({
    data: taskIds.map((taskId) => ({ taskId, actorId: actor.id, type: "unassigned", detail: { userIds: [userId] } })),
  });
}

// ── Owners only ───────────────────────────────────────────────────────────

export async function addMember(
  actor: Actor,
  input: unknown,
): Promise<ActionResult<{ member: Member; tempPassword: string }>> {
  if (!canManageTeam(actor)) return fail("FORBIDDEN", "Only owners can add people to the team.");
  const parsed = addMemberSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID", firstIssue(parsed.error));
  const { name, email, role } = parsed.data;

  // Hashed before the transaction: bcrypt is deliberately slow and the lock
  // should not be held while it runs.
  const tempPassword = generatePassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    return await prisma.$transaction(async (tx) => {
      await lockTeam(tx);
      await assertStillOwner(tx, actor);
      if (await emailInUse(tx, email)) throw new Refusal("INVALID", EMAIL_TAKEN);
      const row = await tx.user.create({
        data: { name, email, role, passwordHash, mustChangePassword: true, color: colorForSeed(email) },
        select: memberSelect,
      });
      // New people appear in the board's assignee pickers.
      const revision = await bumpRevision(tx);
      return { ok: true as const, data: { member: toMember(row), tempPassword }, revision };
    });
  } catch (err) {
    return settle(err);
  }
}

/*
  A fresh temporary password, and the account is sent back to the
  change-password screen. Moving sessionVersion on signs out every session
  already open as them — a lost phone, say — for good; the change-password
  screen alone would hold one back only until the person chose a new
  password, and then the old cookie would work again.
*/
export async function resetMemberPassword(
  actor: Actor,
  id: unknown,
): Promise<ActionResult<{ tempPassword: string }>> {
  if (!canManageTeam(actor)) return fail("FORBIDDEN", "Only owners can reset passwords.");
  const parsed = memberIdSchema.safeParse(id);
  if (!parsed.success) return fail("INVALID", firstIssue(parsed.error));
  if (parsed.data === actor.id) {
    return fail("INVALID", "To change your own password, use Change password in Settings.");
  }

  const tempPassword = generatePassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    return await prisma.$transaction(async (tx) => {
      await lockTeam(tx);
      await assertStillOwner(tx, actor);
      const target = await findTarget(tx, parsed.data);
      await tx.user.update({
        where: { id: target.id },
        data: { passwordHash, mustChangePassword: true, sessionVersion: { increment: 1 } },
      });
      // Someone locked out by failed attempts is usually why the owner is
      // doing this, so the new password works straight away.
      await tx.loginAttempt.deleteMany({ where: { key: { in: loginKeys(target.email, null) } } });
      // Nothing on the board changes, so the revision does not move.
      return { ok: true as const, data: { tempPassword }, revision: await readRevision(tx) };
    });
  } catch (err) {
    return settle(err);
  }
}

/**
  Deactivating takes the person off every task they were assigned to (the
  board offers only active people) but keeps their name on everything they
  wrote or did, and signs out every session they had, so reactivating them
  later does not bring an old cookie back. Reactivating does not put the
  assignments back.
*/
export async function setMemberActive(actor: Actor, id: unknown, active: unknown): Promise<ActionResult<Member>> {
  if (!canManageTeam(actor)) return fail("FORBIDDEN", "Only owners can deactivate or reactivate accounts.");
  const parsedId = memberIdSchema.safeParse(id);
  if (!parsedId.success) return fail("INVALID", firstIssue(parsedId.error));
  const parsedActive = activeSchema.safeParse(active);
  if (!parsedActive.success) return fail("INVALID", firstIssue(parsedActive.error));
  const targetId = parsedId.data;
  const makeActive = parsedActive.data;
  if (targetId === actor.id) {
    return fail("INVALID", "You can't deactivate or reactivate your own account. Ask another owner.");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await lockTeam(tx);
      await assertStillOwner(tx, actor);
      const target = await findTarget(tx, targetId);
      if (target.active === makeActive) {
        return { ok: true as const, data: toMember(target), revision: await readRevision(tx) };
      }
      if (!makeActive && target.role === "OWNER" && (await otherActiveOwners(tx, target.id)) === 0) {
        throw new Refusal(
          "INVALID",
          `${target.name} is the last active owner. Make someone else an owner first.`,
        );
      }
      const row = await tx.user.update({
        where: { id: target.id },
        data: makeActive ? { active: true } : { active: false, sessionVersion: { increment: 1 } },
        select: memberSelect,
      });
      if (!makeActive) await unassignEverywhere(tx, actor, target.id);
      const revision = await bumpRevision(tx);
      return { ok: true as const, data: toMember(row), revision };
    });
  } catch (err) {
    return settle(err);
  }
}

/** Promote to owner or change to staff. Assignments are left alone either way. */
export async function setMemberRole(actor: Actor, id: unknown, role: unknown): Promise<ActionResult<Member>> {
  if (!canManageTeam(actor)) return fail("FORBIDDEN", "Only owners can change someone's role.");
  const parsedId = memberIdSchema.safeParse(id);
  if (!parsedId.success) return fail("INVALID", firstIssue(parsedId.error));
  const parsedRole = roleSchema.safeParse(role);
  if (!parsedRole.success) return fail("INVALID", firstIssue(parsedRole.error));
  const targetId = parsedId.data;
  const newRole = parsedRole.data;
  if (targetId === actor.id) {
    return fail("INVALID", "You can't change your own role. Ask another owner.");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await lockTeam(tx);
      await assertStillOwner(tx, actor);
      const target = await findTarget(tx, targetId);
      if (target.role === newRole) {
        return { ok: true as const, data: toMember(target), revision: await readRevision(tx) };
      }
      if (
        newRole === "STAFF" &&
        target.role === "OWNER" &&
        target.active &&
        (await otherActiveOwners(tx, target.id)) === 0
      ) {
        throw new Refusal("INVALID", `${target.name} is the last active owner. Make someone else an owner first.`);
      }
      const row = await tx.user.update({ where: { id: target.id }, data: { role: newRole }, select: memberSelect });
      const revision = await bumpRevision(tx);
      return { ok: true as const, data: toMember(row), revision };
    });
  } catch (err) {
    return settle(err);
  }
}

// ── Anyone, about themselves ──────────────────────────────────────────────

/** Your own name, avatar colour and animal, which show on every card you are on. */
export async function updateProfile(actor: Actor, input: unknown): Promise<ActionResult<Member>> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID", firstIssue(parsed.error));

  try {
    return await prisma.$transaction(async (tx) => {
      // The board before this person's row, the order an owner's change to
      // them takes the two in (lockTeam); the other way round, they deadlock.
      await lockBoard(tx);
      const exists = await tx.user.findUnique({ where: { id: actor.id }, select: { active: true } });
      if (!exists || !exists.active) throw new Refusal("UNAUTHORIZED", "Your session has ended. Sign in again.");
      const row = await tx.user.update({
        where: { id: actor.id },
        data: { name: parsed.data.name, color: parsed.data.color, ...(parsed.data.avatar ? { avatar: parsed.data.avatar } : {}) },
        select: memberSelect,
      });
      const revision = await bumpRevision(tx);
      return { ok: true as const, data: toMember(row), revision };
    });
  } catch (err) {
    return settle(err);
  }
}

// ── Reads ─────────────────────────────────────────────────────────────────

const ROLE_ORDER = { OWNER: 0, STAFF: 1 } as const;

/**
  Everyone, owners first, then active before deactivated, then by name.
  Callers check the session (and that it is an owner's) first.
*/
export async function listTeam(): Promise<TeamMember[]> {
  const rows = await prisma.user.findMany({
    select: { ...memberSelect, mustChangePassword: true, createdAt: true },
  });
  return rows
    .map((r) => ({ ...toMember(r), mustChangePassword: r.mustChangePassword, createdAt: r.createdAt.toISOString() }))
    .sort(
      (a, b) =>
        ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
        Number(b.active) - Number(a.active) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
}

// ── For the Server Actions ────────────────────────────────────────────────

/**
  requireUser() throws a bare code; this turns it into the result the
  browser expects. Anything else is a real fault and is rethrown.
*/
export function sessionFailure<T>(err: unknown): ActionResult<T> {
  const message = err instanceof Error ? err.message : "";
  if (message === "UNAUTHORIZED") return fail("UNAUTHORIZED", "Your session has ended. Sign in again.");
  if (message === "PASSWORD_CHANGE_REQUIRED") {
    return fail("PASSWORD_CHANGE_REQUIRED", "Choose your own password before carrying on.");
  }
  if (message === "FORBIDDEN") return fail("FORBIDDEN", NOT_OWNER);
  throw err;
}
