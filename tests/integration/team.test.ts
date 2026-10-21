import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { colorForSeed } from "@/lib/colors";
import type { Actor, Role } from "@/lib/permissions";
import { hashPassword, verifyPassword } from "@/modules/auth/password";
import { ALREADY_SET_UP, createFirstOwner, hasAnyUser, STARTER_LABELS } from "@/modules/auth/setup";
import { updateTask } from "@/modules/tasks/service";
import { lockBoard } from "@/modules/tasks/revision";
import { updateTaskSchema } from "@/modules/tasks/validation";
import {
  addMember,
  listTeam,
  resetMemberPassword,
  setMemberActive,
  setMemberRole,
  updateProfile,
} from "@/modules/team/service";

/*
  The team service against a real Postgres. The rules worth pinning — the
  board is never left without an active owner, a deactivated person comes off
  every task, a second /setup is refused — live in transactions and locks that
  a mock would happily pretend work.

  Empties every table between tests, so it only runs against a database whose
  URL says it is a test one.
*/

const url = process.env.DATABASE_URL ?? "";
const enabled = url.includes("test");

async function reset() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Activity", "Comment", "ChecklistItem", "TaskLabel", "TaskAssignee", "Task", "Label", "LoginAttempt", "BoardRevision", "User" RESTART IDENTITY CASCADE`,
  );
}

let seq = 0;
async function makeUser(role: Role, over: { active?: boolean; name?: string; email?: string } = {}) {
  seq += 1;
  const email = over.email ?? `${role.toLowerCase()}${seq}@example.com`;
  const row = await prisma.user.create({
    data: {
      email,
      name: over.name ?? `${role === "OWNER" ? "Owner" : "Staff"} ${seq}`,
      role,
      active: over.active ?? true,
      passwordHash: await hashPassword("correct horse battery"),
    },
  });
  return { ...row, actor: { id: row.id, role: row.role } as Actor };
}

async function makeTask(createdById: string, assigneeIds: string[]) {
  return prisma.task.create({
    data: {
      title: "Order cardamom",
      position: 1,
      createdById,
      updatedById: createdById,
      assignees: { create: assigneeIds.map((userId) => ({ userId })) },
    },
  });
}

async function revision() {
  return (await prisma.boardRevision.findUnique({ where: { id: 1 } }))?.revision ?? 0;
}

async function activeOwners() {
  return prisma.user.count({ where: { role: "OWNER", active: true } });
}

async function sessionVersion(id: string) {
  return (await prisma.user.findUniqueOrThrow({ where: { id }, select: { sessionVersion: true } })).sessionVersion;
}

/** Resolves once `count` statements are queued behind a lock somebody else holds. */
async function lockWaiters(count: number) {
  for (let i = 0; i < 200; i++) {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if ((row?.n ?? 0) >= count) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`never saw ${count} statement(s) waiting on a lock`);
}

describe.skipIf(!enabled)("team service (integration)", () => {
  beforeEach(reset);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("staff are refused every owners-only action", () => {
    it("returns FORBIDDEN and changes nothing", async () => {
      const owner = await makeUser("OWNER");
      const staff = await makeUser("STAFF");
      const other = await makeUser("STAFF");

      const results = await Promise.all([
        addMember(staff.actor, { name: "New Person", email: "new@example.com", role: "STAFF" }),
        resetMemberPassword(staff.actor, other.id),
        setMemberActive(staff.actor, other.id, false),
        setMemberRole(staff.actor, other.id, "OWNER"),
        setMemberRole(staff.actor, staff.id, "OWNER"),
        setMemberActive(staff.actor, owner.id, false),
      ]);
      for (const r of results) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe("FORBIDDEN");
      }
      expect(await prisma.user.count()).toBe(3);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });
      expect(after.active).toBe(true);
      expect(after.role).toBe("STAFF");
      expect(after.passwordHash).toBe(other.passwordHash);
    });

    it("re-checks the database, so an owner demoted a moment ago is refused", async () => {
      const a = await makeUser("OWNER");
      await makeUser("OWNER");
      const target = await makeUser("STAFF");
      await prisma.user.update({ where: { id: a.id }, data: { role: "STAFF" } });

      // The session (a.actor) still says OWNER; the row no longer does.
      const r = await setMemberActive(a.actor, target.id, false);
      expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    });

    it("lets staff update their own profile", async () => {
      const staff = await makeUser("STAFF");
      const r = await updateProfile(staff.actor, { name: "  Asha  ", color: "teal" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data).toMatchObject({ name: "Asha", color: "teal", role: "STAFF" });
    });
  });

  describe("addMember", () => {
    it("creates a hashed temporary password, mustChangePassword and the chosen role", async () => {
      const owner = await makeUser("OWNER");
      const before = await revision();

      const r = await addMember(owner.actor, { name: " Ravi Patel ", email: "  Ravi@Example.COM ", role: "OWNER" });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.member).toMatchObject({ name: "Ravi Patel", email: "ravi@example.com", role: "OWNER", active: true });
      expect(r.data.tempPassword).toMatch(/^[A-Za-z0-9]{12}$/);
      expect(r.revision).toBe(before + 1);

      const row = await prisma.user.findUniqueOrThrow({ where: { email: "ravi@example.com" } });
      expect(row.passwordHash).not.toBe(r.data.tempPassword);
      expect(await verifyPassword(r.data.tempPassword, row.passwordHash)).toBe(true);
      expect(row.mustChangePassword).toBe(true);
      expect(row.role).toBe("OWNER");
      expect(row.color).toBe(colorForSeed("ravi@example.com"));
    });

    it("defaults nothing: a staff member is created as staff", async () => {
      const owner = await makeUser("OWNER");
      const r = await addMember(owner.actor, { name: "Meera", email: "meera@example.com", role: "STAFF" });
      expect(r.ok && r.data.member.role).toBe("STAFF");
    });

    it("rejects a duplicate email in any case, including one stored with capitals", async () => {
      const owner = await makeUser("OWNER");
      await makeUser("STAFF", { email: "Legacy@Example.com" });
      expect((await addMember(owner.actor, { name: "A", email: "dup@example.com", role: "STAFF" })).ok).toBe(true);

      for (const email of ["DUP@example.com", " dup@EXAMPLE.com ", "legacy@example.com"]) {
        const r = await addMember(owner.actor, { name: "B", email, role: "STAFF" });
        expect(r).toMatchObject({ ok: false, code: "INVALID" });
        if (!r.ok) expect(r.error).toMatch(/already uses that email/);
      }
      expect(await prisma.user.count()).toBe(3);
    });

    it("compares emails literally, so an underscore is not a wildcard", async () => {
      const owner = await makeUser("OWNER");
      await makeUser("STAFF", { email: "joxsmith@cafe.test" });
      const r = await addMember(owner.actor, { name: "Jo", email: "jo_smith@cafe.test", role: "STAFF" });
      expect(r.ok).toBe(true);
      expect(await addMember(owner.actor, { name: "Jo", email: "JO_SMITH@cafe.test", role: "STAFF" })).toMatchObject({
        ok: false,
        code: "INVALID",
      });
    });

    it("lets only one of two simultaneous adds of the same email through", async () => {
      const owner = await makeUser("OWNER");
      const [a, b] = await Promise.all([
        addMember(owner.actor, { name: "One", email: "same@example.com", role: "STAFF" }),
        addMember(owner.actor, { name: "Two", email: "Same@example.com", role: "STAFF" }),
      ]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      expect(await prisma.user.count({ where: { email: "same@example.com" } })).toBe(1);
    });

    it("validates its input", async () => {
      const owner = await makeUser("OWNER");
      const cases: unknown[] = [
        { name: "", email: "x@example.com", role: "STAFF" },
        { name: "x".repeat(81), email: "x@example.com", role: "STAFF" },
        { name: "X", email: "not-an-email", role: "STAFF" },
        { name: "X", email: "x@example.com", role: "ADMIN" },
        { name: "X", email: "x@example.com" },
        { name: "Sam\u0000", email: "x@example.com", role: "STAFF" },
      ];
      for (const input of cases) {
        expect(await addMember(owner.actor, input)).toMatchObject({ ok: false, code: "INVALID" });
      }
    });
  });

  describe("roles", () => {
    it("promotes and demotes, bumping the revision", async () => {
      const owner = await makeUser("OWNER");
      const staff = await makeUser("STAFF");
      const before = await revision();

      const up = await setMemberRole(owner.actor, staff.id, "OWNER");
      expect(up.ok && up.data.role).toBe("OWNER");
      const down = await setMemberRole(owner.actor, staff.id, "STAFF");
      expect(down.ok && down.data.role).toBe("STAFF");
      expect(await revision()).toBe(before + 2);
    });

    it("refuses to change your own role, even the only owner's", async () => {
      const owner = await makeUser("OWNER");
      const r = await setMemberRole(owner.actor, owner.id, "STAFF");
      expect(r).toMatchObject({ ok: false, code: "INVALID" });
      expect(await activeOwners()).toBe(1);
    });

    it("never demotes the last active owner, even when two owners demote each other at once", async () => {
      const a = await makeUser("OWNER");
      const b = await makeUser("OWNER");
      const [ab, ba] = await Promise.all([
        setMemberRole(a.actor, b.id, "STAFF"),
        setMemberRole(b.actor, a.id, "STAFF"),
      ]);
      expect([ab.ok, ba.ok].filter(Boolean)).toHaveLength(1);
      const refused = ab.ok ? ba : ab;
      expect(refused).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await activeOwners()).toBe(1);
    });

    it("does not count a deactivated owner as cover", async () => {
      const a = await makeUser("OWNER");
      const b = await makeUser("OWNER");
      await makeUser("OWNER", { active: false });
      expect((await setMemberRole(a.actor, b.id, "STAFF")).ok).toBe(true);
      // a is now the only active owner and cannot be demoted by anyone left.
      expect(await activeOwners()).toBe(1);
      expect(await setMemberRole(b.actor, a.id, "STAFF")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    });

    it("leaves a demoted owner's assignments alone", async () => {
      const a = await makeUser("OWNER");
      const b = await makeUser("OWNER");
      await makeTask(a.id, [b.id]);
      expect((await setMemberRole(a.actor, b.id, "STAFF")).ok).toBe(true);
      expect(await prisma.taskAssignee.count({ where: { userId: b.id } })).toBe(1);
    });

    it("says NOT_FOUND for someone who does not exist", async () => {
      const owner = await makeUser("OWNER");
      expect(await setMemberRole(owner.actor, "nobody", "OWNER")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    });
  });

  describe("deactivation", () => {
    it("refuses to deactivate yourself", async () => {
      const owner = await makeUser("OWNER");
      await makeUser("OWNER");
      expect(await setMemberActive(owner.actor, owner.id, false)).toMatchObject({ ok: false, code: "INVALID" });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).active).toBe(true);
    });

    it("never deactivates the last active owner, even when two owners try it on each other at once", async () => {
      const a = await makeUser("OWNER");
      const b = await makeUser("OWNER");
      const [ab, ba] = await Promise.all([setMemberActive(a.actor, b.id, false), setMemberActive(b.actor, a.id, false)]);
      expect([ab.ok, ba.ok].filter(Boolean)).toHaveLength(1);
      expect(await activeOwners()).toBe(1);
    });

    it("removes every assignment, keeps their history and bumps the revision once", async () => {
      const owner = await makeUser("OWNER");
      const staff = await makeUser("STAFF");
      const t1 = await makeTask(owner.id, [staff.id, owner.id]);
      await makeTask(owner.id, [staff.id]);
      await prisma.comment.create({ data: { taskId: t1.id, authorId: staff.id, body: "On it" } });
      const before = await revision();

      const r = await setMemberActive(owner.actor, staff.id, false);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.active).toBe(false);
      expect(r.revision).toBe(before + 1);
      expect(await revision()).toBe(before + 1);
      expect(await prisma.taskAssignee.count({ where: { userId: staff.id } })).toBe(0);
      expect(await prisma.taskAssignee.count({ where: { userId: owner.id } })).toBe(1);
      expect(await prisma.comment.count({ where: { authorId: staff.id } })).toBe(1);
    });

    it("records the removal on each card and moves its version, so an open edit is told rather than refused", async () => {
      const owner = await makeUser("OWNER");
      const editor = await makeUser("OWNER");
      const dev = await makeUser("STAFF", { name: "Dev" });
      const cara = await makeUser("STAFF", { name: "Cara" });
      const theirs = await makeTask(editor.id, [dev.id]);
      const untouched = await makeTask(editor.id, [cara.id]);

      expect((await setMemberActive(owner.actor, dev.id, false)).ok).toBe(true);

      const card = await prisma.task.findUniqueOrThrow({ where: { id: theirs.id } });
      expect(card.version).toBe(theirs.version + 1);
      expect(card.updatedById).toBe(owner.id);
      const history = await prisma.activity.findMany({ where: { taskId: theirs.id } });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ type: "unassigned", actorId: owner.id, detail: { userIds: [dev.id] } });
      expect((await prisma.task.findUniqueOrThrow({ where: { id: untouched.id } })).version).toBe(untouched.version);
      expect(await prisma.activity.count({ where: { taskId: untouched.id } })).toBe(0);

      // An owner who had the card open, still showing Dev, adds Cara.
      const stale = await updateTask(
        editor.actor,
        updateTaskSchema.parse({ id: theirs.id, version: theirs.version, assigneeIds: [dev.id, cara.id] }),
      );
      expect(stale).toMatchObject({ ok: false, code: "CONFLICT" });
    });

    it("signs out every session they had, so reactivating them later does not revive an old cookie", async () => {
      const owner = await makeUser("OWNER");
      const staff = await makeUser("STAFF");
      const before = await sessionVersion(staff.id);

      expect((await setMemberActive(owner.actor, staff.id, false)).ok).toBe(true);
      expect(await sessionVersion(staff.id)).toBe(before + 1);
      // Already off: nothing changes.
      expect((await setMemberActive(owner.actor, staff.id, false)).ok).toBe(true);
      expect(await sessionVersion(staff.id)).toBe(before + 1);
      expect((await setMemberActive(owner.actor, staff.id, true)).ok).toBe(true);
      expect(await sessionVersion(staff.id)).toBe(before + 1);
    });

    it("reactivates without restoring assignments", async () => {
      const owner = await makeUser("OWNER");
      const staff = await makeUser("STAFF");
      await makeTask(owner.id, [staff.id]);
      await setMemberActive(owner.actor, staff.id, false);
      const r = await setMemberActive(owner.actor, staff.id, true);
      expect(r.ok && r.data.active).toBe(true);
      expect(await prisma.taskAssignee.count({ where: { userId: staff.id } })).toBe(0);
    });

    it("can deactivate an owner while another owner remains", async () => {
      const a = await makeUser("OWNER");
      const b = await makeUser("OWNER");
      expect((await setMemberActive(a.actor, b.id, false)).ok).toBe(true);
      expect(await activeOwners()).toBe(1);
    });
  });

  describe("password reset", () => {
    it("sets a new temporary password, forces a change and clears their lockout", async () => {
      const owner = await makeUser("OWNER");
      const staff = await makeUser("STAFF");
      await prisma.loginAttempt.create({
        data: { key: `email:${staff.email}`, failures: 5, lockedUntil: new Date(Date.now() + 60_000) },
      });
      const before = await revision();

      const r = await resetMemberPassword(owner.actor, staff.id);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const row = await prisma.user.findUniqueOrThrow({ where: { id: staff.id } });
      expect(await verifyPassword(r.data.tempPassword, row.passwordHash)).toBe(true);
      expect(row.mustChangePassword).toBe(true);
      expect(await prisma.loginAttempt.count()).toBe(0);
      expect(r.revision).toBe(before);
    });

    it("signs out every session already open as them", async () => {
      const owner = await makeUser("OWNER");
      const staff = await makeUser("STAFF");
      const before = await sessionVersion(staff.id);
      expect((await resetMemberPassword(owner.actor, staff.id)).ok).toBe(true);
      expect(await sessionVersion(staff.id)).toBe(before + 1);
    });

    it("is not for your own account", async () => {
      const owner = await makeUser("OWNER");
      expect(await resetMemberPassword(owner.actor, owner.id)).toMatchObject({ ok: false, code: "INVALID" });
    });
  });

  describe("profile", () => {
    it("rejects an unknown colour and an empty name", async () => {
      const owner = await makeUser("OWNER");
      expect(await updateProfile(owner.actor, { name: "Fine", color: "#ff0000" })).toMatchObject({
        ok: false,
        code: "INVALID",
      });
      expect(await updateProfile(owner.actor, { name: "   ", color: "rust" })).toMatchObject({
        ok: false,
        code: "INVALID",
      });
    });

    it("bumps the revision, since avatars show on cards", async () => {
      const owner = await makeUser("OWNER");
      const before = await revision();
      const r = await updateProfile(owner.actor, { name: "Harsh", color: "plum" });
      expect(r.ok && r.revision).toBe(before + 1);
    });

    it("saves a picked animal and refuses one outside the club", async () => {
      const owner = await makeUser("OWNER");
      const r = await updateProfile(owner.actor, { name: "Harsh", color: "plum", avatar: "tiger" });
      expect(r.ok && r.data.avatar).toBe("tiger");
      const stored = await prisma.user.findUnique({ where: { id: owner.id }, select: { avatar: true } });
      expect(stored?.avatar).toBe("tiger");
      expect(await updateProfile(owner.actor, { name: "Harsh", color: "plum", avatar: "dragon" })).toMatchObject({
        ok: false,
        code: "INVALID",
      });
    });

    it("refuses a name with a NUL character instead of failing the write", async () => {
      const owner = await makeUser("OWNER");
      expect(await updateProfile(owner.actor, { name: "Har\u0000sh", color: "plum" })).toMatchObject({
        ok: false,
        code: "INVALID",
      });
    });

    it("waits for the board before locking its own row, so it cannot deadlock with an owner's change to them", async () => {
      const owner = await makeUser("OWNER");
      const staff = await makeUser("STAFF");
      await prisma.boardRevision.create({ data: { id: 1, revision: 0 } });

      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let held!: () => void;
      const boardHeld = new Promise<void>((r) => (held = r));
      const hold = prisma.$transaction(
        async (tx) => {
          await lockBoard(tx);
          held();
          await gate;
        },
        { timeout: 20_000 },
      );
      await boardHeld;

      // The owner's reset queues on the board first, then the profile save.
      const reset = resetMemberPassword(owner.actor, staff.id);
      await lockWaiters(1);
      const profile = updateProfile(staff.actor, { name: "Asha", color: "teal" });
      await lockWaiters(2);

      // Holding the staff row while queued behind the reset is what deadlocked.
      let rowLocked = false;
      try {
        await prisma.$transaction((tx) => tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${staff.id} FOR UPDATE NOWAIT`);
      } catch {
        rowLocked = true;
      }
      release();
      await hold;
      const results = await Promise.allSettled([reset, profile]);

      expect(rowLocked).toBe(false);
      for (const r of results) expect(r).toMatchObject({ status: "fulfilled", value: { ok: true } });
    });
  });

  describe("listTeam", () => {
    it("lists owners first, then active before deactivated, then by name", async () => {
      await makeUser("STAFF", { name: "zed" });
      await makeUser("STAFF", { name: "Amy", active: false });
      await makeUser("STAFF", { name: "bob" });
      await makeUser("OWNER", { name: "Yara" });
      const team = await listTeam();
      expect(team.map((m) => m.name)).toEqual(["Yara", "bob", "zed", "Amy"]);
    });
  });

  describe("first-run setup", () => {
    const input = {
      name: "Harsh",
      email: " Harsh@Example.com ",
      password: "a long enough password",
      confirmPassword: "a long enough password",
    };

    it("creates the first account as an owner with starter labels", async () => {
      expect(await hasAnyUser()).toBe(false);
      const r = await createFirstOwner(input);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data).toMatchObject({ email: "harsh@example.com", role: "OWNER", active: true });
      const row = await prisma.user.findUniqueOrThrow({ where: { email: "harsh@example.com" } });
      expect(row.mustChangePassword).toBe(false);
      expect(await verifyPassword(input.password, row.passwordHash)).toBe(true);
      const labels = await prisma.label.findMany({ orderBy: { name: "asc" } });
      expect(labels.map((l) => l.name)).toEqual(STARTER_LABELS.map((l) => l.name).sort());
      expect(await revision()).toBe(1);
    });

    it("refuses once anybody exists", async () => {
      await makeUser("STAFF");
      const r = await createFirstOwner(input);
      expect(r).toMatchObject({ ok: false, code: "FORBIDDEN", error: ALREADY_SET_UP });
      expect(await prisma.user.count()).toBe(1);
    });

    it("lets exactly one of two simultaneous setups through", async () => {
      const results = await Promise.all([
        createFirstOwner(input),
        createFirstOwner({ ...input, email: "someone-else@example.com" }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(await prisma.user.count()).toBe(1);
    });

    it("validates the password and its confirmation", async () => {
      expect(await createFirstOwner({ ...input, password: "short", confirmPassword: "short" })).toMatchObject({
        ok: false,
        code: "INVALID",
      });
      expect(await createFirstOwner({ ...input, confirmPassword: "something else entirely" })).toMatchObject({
        ok: false,
        code: "INVALID",
      });
      expect(await prisma.user.count()).toBe(0);
    });
  });
});
