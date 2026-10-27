import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  Who sees which task, against a real Postgres: staff do not see what owners
  are working on (canSeeTask in src/lib/permissions.ts), and every read and
  write treats a hidden task as one that does not exist. Same guard as the
  task suite — every table is emptied, so it runs only on a test database.
*/

// Push goes out through Next's after(); collect the jobs so a test can wait
// for them, and stand in for the push service so nothing leaves the box.
const push = vi.hoisted(() => ({
  jobs: [] as Promise<unknown>[],
  sent: [] as Array<{ endpoint: string; body: string }>,
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (job: () => Promise<unknown>) => {
    push.jobs.push(job());
  },
}));
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (sub: { endpoint: string }, payload: string) => {
      push.sent.push({ endpoint: sub.endpoint, body: (JSON.parse(payload) as { body: string }).body });
    },
  },
}));
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-public";
process.env.VAPID_PRIVATE_KEY = "test-private";
process.env.VAPID_SUBJECT = "mailto:test@example.test";

const { prisma } = await import("@/lib/prisma");
const { canSeeTask } = await import("@/lib/permissions");
const { getArchivedTasks, getBoard, getTaskDetail } = await import("@/modules/tasks/queries");
const svc = await import("@/modules/tasks/service");
const team = await import("@/modules/team/service");
const { getNotificationFeed } = await import("@/modules/notifications/queries");
const { toVisibility, visibilitySelect, visibleTaskWhere } = await import("@/modules/tasks/visibility");
const { createTaskSchema, moveTaskSchema } = await import("@/modules/tasks/validation");
type Actor = import("@/lib/permissions").Actor;
type Role = import("@/lib/permissions").Role;
type ActionResult<T> = import("@/modules/tasks/types").ActionResult<T>;

const RUN = (process.env.DATABASE_URL ?? "").includes("test");

async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Activity", "Comment", "ChecklistItem", "TaskLabel", "TaskAssignee", "Task", "Label", "User", "BoardRevision", "LoginAttempt", "PushSubscription" CASCADE`,
  );
}

let seq = 0;
async function makeUser(name: string, role: Role): Promise<Actor> {
  const user = await prisma.user.create({
    data: { name, email: `${name.toLowerCase()}-${++seq}@example.test`, passwordHash: "x", role },
  });
  return { id: user.id, role };
}

function data<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.error}`);
  return result.data;
}

function refused<T>(result: ActionResult<T>, code: string, error?: string) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.code).toBe(code);
  if (error !== undefined) expect(result.error).toBe(error);
  return result;
}

const create = (actor: Actor, title: string, assigneeIds: string[] = [], status: "TODO" | "DONE" = "TODO") =>
  svc.createTask(actor, createTaskSchema.parse({ title, assigneeIds, status }));

async function boardTitles(actor: Actor): Promise<string[]> {
  return (await getBoard(actor)).tasks.map((t) => t.title).sort();
}

/** Push jobs run after the write returns; wait for every one started so far. */
async function settlePush() {
  while (push.jobs.length) await Promise.all(push.jobs.splice(0));
}

describe.skipIf(!RUN)("task visibility (Postgres)", () => {
  let owner: Actor;
  let owner2: Actor;
  let staff: Actor;
  let staff2: Actor;
  // One of each kind of task, as the staff member `staff` sees them.
  let unassigned: string;
  let ownerOnly: string;
  let staffOnly: string;
  let ownerAndMe: string;
  let ownerAndOtherStaff: string;

  beforeEach(async () => {
    await resetDatabase();
    push.jobs.length = 0;
    push.sent.length = 0;
    owner = await makeUser("Harsh", "OWNER");
    owner2 = await makeUser("Priya", "OWNER");
    staff = await makeUser("Sam", "STAFF");
    staff2 = await makeUser("Tara", "STAFF");
    unassigned = data(await create(owner, "Unassigned")).id;
    ownerOnly = data(await create(owner, "Owner only", [owner2.id])).id;
    staffOnly = data(await create(owner, "Staff only", [staff2.id])).id;
    ownerAndMe = data(await create(owner, "Owner and me", [owner2.id, staff.id])).id;
    ownerAndOtherStaff = data(await create(owner, "Owner and Tara", [owner2.id, staff2.id])).id;
    await settlePush();
    push.sent.length = 0;
  });

  // A push still reading when the next test empties the tables fails noisily.
  afterEach(settlePush);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("the board", () => {
    it("shows staff unassigned, staff-only and their own tasks, not what owners are on", async () => {
      expect(await boardTitles(staff)).toEqual(["Owner and me", "Staff only", "Unassigned"]);
      expect(await boardTitles(staff2)).toEqual(["Owner and Tara", "Staff only", "Unassigned"]);
    });

    it("still lists every member, so names and avatars work", async () => {
      const board = await getBoard(staff);
      expect(board.members.map((m) => m.id).sort()).toEqual([owner.id, owner2.id, staff.id, staff2.id].sort());
    });

    it("shows owners everything", async () => {
      expect(await boardTitles(owner)).toEqual([
        "Owner and Tara",
        "Owner and me",
        "Owner only",
        "Staff only",
        "Unassigned",
      ]);
    });

    it("hides a task from staff the moment an owner is put on it", async () => {
      data(await svc.updateTask(owner, { id: unassigned, version: 1, assigneeIds: [owner.id] }));
      expect(await boardTitles(staff)).not.toContain("Unassigned");
    });

    it("goes by the current role: demoting an owner reveals their tasks, promoting staff hides theirs", async () => {
      data(await team.setMemberRole(owner, owner2.id, "STAFF"));
      expect(await boardTitles(staff)).toContain("Owner only");
      expect(await getTaskDetail(ownerOnly, staff)).not.toBeNull();

      data(await team.setMemberRole(owner, staff2.id, "OWNER"));
      expect(await boardTitles(staff)).not.toContain("Staff only");
    });

    it("uses a deactivated owner's stored role", async () => {
      // Deactivating takes people off their tasks; an assignment left over
      // from before that rule still counts by the role stored.
      await prisma.user.update({ where: { id: owner2.id }, data: { active: false } });
      expect(await boardTitles(staff)).not.toContain("Owner only");
      data(await team.setMemberActive(owner, owner2.id, true));
      data(await team.setMemberActive(owner, owner2.id, false));
      expect(await boardTitles(staff)).toContain("Owner only");
    });

    it("agrees with canSeeTask for every task and viewer", async () => {
      const rows = await prisma.task.findMany({ select: { id: true, ...visibilitySelect } });
      for (const viewer of [owner, owner2, staff, staff2]) {
        const listed = await prisma.task.findMany({ where: visibleTaskWhere(viewer), select: { id: true } });
        const expected = rows.filter((r) => canSeeTask(viewer, toVisibility(r))).map((r) => r.id);
        expect(listed.map((r) => r.id).sort()).toEqual(expected.sort());
      }
    });
  });

  describe("a hidden task", () => {
    const gone = "This task no longer exists. Someone may have deleted it.";

    it("reads as not there", async () => {
      expect(await getTaskDetail(ownerOnly, staff)).toBeNull();
      expect(await getTaskDetail(ownerAndOtherStaff, staff)).toBeNull();
      expect(await getTaskDetail(ownerAndMe, staff)).not.toBeNull();
      expect(await getTaskDetail(ownerOnly, owner)).not.toBeNull();
    });

    it("refuses every staff write exactly as a missing task does", async () => {
      const missing = "cmissingtask000000000000";
      for (const id of [ownerOnly, missing]) {
        refused(await svc.joinTask(staff, id), "NOT_FOUND", gone);
        refused(await svc.leaveTask(staff, id), "NOT_FOUND", gone);
        refused(
          await svc.moveTask(staff, moveTaskSchema.parse({ id, status: "IN_PROGRESS", afterId: null, beforeId: null })),
          "NOT_FOUND",
          gone,
        );
        refused(await svc.addComment(staff, { taskId: id, body: "Hello?" }), "NOT_FOUND", gone);
        refused(await svc.addChecklistItem(staff, { taskId: id, text: "Peek" }), "NOT_FOUND", gone);
      }
      expect((await getTaskDetail(ownerOnly, owner))?.comments).toEqual([]);
    });

    it("hides its checklist items and comments too, even the staff member's own", async () => {
      // Visible while unassigned: the staff member comments, then an owner takes it.
      const comment = data(await svc.addComment(staff, { taskId: unassigned, body: "On it soon" }));
      const item = data(await svc.addChecklistItem(owner, { taskId: unassigned, text: "Milk" }));
      data(await svc.updateTask(owner, { id: unassigned, version: 1, assigneeIds: [owner.id] }));

      refused(await svc.editComment(staff, { id: comment.id, body: "Edited" }), "NOT_FOUND", "That comment no longer exists.");
      refused(await svc.deleteComment(staff, comment.id), "NOT_FOUND", "That comment no longer exists.");
      refused(
        await svc.updateChecklistItem(staff, { id: item.id, done: true }),
        "NOT_FOUND",
        "That checklist item no longer exists.",
      );
      refused(await svc.deleteChecklistItem(staff, item.id), "NOT_FOUND", "That checklist item no longer exists.");
    });

    it("cannot be named as a neighbour in a move", async () => {
      const mine = data(await create(owner, "Mine", [staff.id])).id;
      // Hidden: treated as a stale neighbour, so the card goes to the bottom,
      // just as it does for an id that does not exist.
      const moved = data(
        await svc.moveTask(staff, moveTaskSchema.parse({ id: mine, status: "TODO", afterId: ownerOnly, beforeId: null })),
      );
      const todo = (await getBoard(owner)).tasks.filter((t) => t.status === "TODO");
      expect(todo.at(-1)?.id).toBe(moved.id);
    });

    it("still lets owners do everything with it", async () => {
      data(await svc.addComment(owner, { taskId: ownerOnly, body: "Fine" }));
      data(await svc.moveTask(owner, moveTaskSchema.parse({ id: ownerOnly, status: "DONE", afterId: null, beforeId: null })));
    });

    it("stays workable by staff who are on it", async () => {
      data(await svc.addComment(staff, { taskId: ownerAndMe, body: "Done my bit" }));
      data(await svc.addChecklistItem(staff, { taskId: ownerAndMe, text: "Cups" }));
      data(
        await svc.moveTask(staff, moveTaskSchema.parse({ id: ownerAndMe, status: "IN_PROGRESS", afterId: null, beforeId: null })),
      );
    });
  });

  describe("the archive", () => {
    it("lists for staff only the archived tasks they could see", async () => {
      for (const id of [unassigned, ownerOnly, staffOnly, ownerAndMe, ownerAndOtherStaff]) {
        data(await svc.archiveTask(owner, id));
      }
      const titles = async (a: Actor) => (await getArchivedTasks(a)).map((t) => t.title).sort();
      expect(await titles(staff)).toEqual(["Owner and me", "Staff only", "Unassigned"]);
      expect(await titles(owner)).toHaveLength(5);
      expect(await getTaskDetail(ownerOnly, staff)).toBeNull();
    });
  });

  describe("notifications", () => {
    async function subscribe(actor: Actor) {
      await prisma.pushSubscription.create({
        data: { userId: actor.id, endpoint: `https://push.example.test/${actor.id}`, p256dh: "k", auth: "a" },
      });
    }
    const sentTo = (actor: Actor) =>
      push.sent.filter((s) => s.endpoint === `https://push.example.test/${actor.id}`).map((s) => s.body);

    it("never puts a hidden task in a staff member's bell", async () => {
      data(await svc.addComment(owner, { taskId: ownerOnly, body: "Private" }));
      data(await svc.addComment(owner, { taskId: unassigned, body: "Anyone?" }));
      data(await svc.addComment(owner, { taskId: ownerAndMe, body: "Ours" }));

      const feed = await getNotificationFeed(staff);
      const ids = new Set(feed.items.map((i) => i.taskId));
      expect(ids.has(ownerOnly)).toBe(false);
      expect(ids.has(ownerAndOtherStaff)).toBe(false);
      expect(ids.has(unassigned)).toBe(true);
      expect(ids.has(ownerAndMe)).toBe(true);
      expect(feed.unread).toBe(feed.items.length);

      expect(new Set((await getNotificationFeed(owner2)).items.map((i) => i.taskId)).has(ownerOnly)).toBe(true);
    });

    it("takes a task's whole history out of the bell once an owner is on it", async () => {
      data(await svc.addComment(owner, { taskId: unassigned, body: "Anyone?" }));
      expect((await getNotificationFeed(staff)).items.some((i) => i.taskId === unassigned)).toBe(true);
      data(await svc.updateTask(owner, { id: unassigned, version: 1, assigneeIds: [owner2.id] }));
      expect((await getNotificationFeed(staff)).items.some((i) => i.taskId === unassigned)).toBe(false);
    });

    it("never pushes a hidden task to staff", async () => {
      for (const who of [owner2, staff, staff2]) await subscribe(who);

      data(await svc.addComment(owner, { taskId: ownerOnly, body: "Private" }));
      await settlePush();
      expect(sentTo(owner2)).toHaveLength(1);
      expect(sentTo(staff)).toEqual([]);
      expect(sentTo(staff2)).toEqual([]);

      // Putting an owner on a task is not news to the staff it now hides from.
      push.sent.length = 0;
      data(await svc.updateTask(owner, { id: staffOnly, version: 1, assigneeIds: [staff2.id, owner.id] }));
      await settlePush();
      expect(sentTo(staff)).toEqual([]);
      expect(sentTo(staff2)).toHaveLength(1);

      push.sent.length = 0;
      data(await svc.addComment(owner, { taskId: unassigned, body: "Anyone?" }));
      await settlePush();
      expect(sentTo(staff)).toHaveLength(1);
    });

    it("counts only visible tasks in a bulk-archive push", async () => {
      await subscribe(staff);
      for (const id of [unassigned, ownerOnly, ownerAndOtherStaff]) {
        data(await svc.moveTask(owner, moveTaskSchema.parse({ id, status: "DONE", afterId: null, beforeId: null })));
      }
      await settlePush();
      push.sent.length = 0;
      data(await svc.archiveDone(owner));
      await settlePush();
      expect(sentTo(staff)).toEqual(["Harsh archived 1 completed task"]);
    });
  });
});
