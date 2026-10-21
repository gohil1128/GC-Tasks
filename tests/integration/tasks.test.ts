import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Actor, Role } from "@/lib/permissions";
import * as labels from "@/modules/labels/service";
import { POSITION_STEP } from "@/modules/tasks/position";
import { getArchivedTasks, getBoard, getRevision, getTaskDetail } from "@/modules/tasks/queries";
import * as svc from "@/modules/tasks/service";
import type { ActionResult, CreateTaskInput, Status, TaskCard, UpdateTaskInput } from "@/modules/tasks/types";
import {
  createLabelSchema,
  createTaskSchema,
  moveTaskSchema,
  updateLabelSchema,
  updateTaskSchema,
} from "@/modules/tasks/validation";

/*
  The task service against a real Postgres. Every table is emptied before
  each test, so this only runs when DATABASE_URL looks like a test database —
  pointing it at the real board by accident must be impossible, not merely
  unlikely.
*/
const RUN = (process.env.DATABASE_URL ?? "").includes("test");

// ── Helpers ────────────────────────────────────────────────────────────────

async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Activity", "Comment", "ChecklistItem", "TaskLabel", "TaskAssignee", "Task", "Label", "User", "BoardRevision", "LoginAttempt" CASCADE`,
  );
}

let seq = 0;
async function makeUser(name: string, role: Role = "OWNER", active = true): Promise<Actor> {
  const user = await prisma.user.create({
    data: { name, email: `${name.toLowerCase()}-${++seq}@example.test`, passwordHash: "x", role, active },
  });
  return { id: user.id, role };
}

function data<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.error}`);
  return result.data;
}

function refused<T>(result: ActionResult<T>, code: string) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.code).toBe(code);
  return result;
}

const create = (actor: Actor, input: CreateTaskInput) => svc.createTask(actor, createTaskSchema.parse(input));
const update = (actor: Actor, input: UpdateTaskInput) => svc.updateTask(actor, updateTaskSchema.parse(input));
const move = (actor: Actor, id: string, status: Status, afterId: string | null = null, beforeId: string | null = null) =>
  svc.moveTask(actor, moveTaskSchema.parse({ id, status, afterId, beforeId }));
const newLabel = (actor: Actor, name: string, color = "teal") =>
  labels.createLabel(actor, createLabelSchema.parse({ name, color }));

async function titlesIn(status: Status): Promise<string[]> {
  const board = await getBoard();
  return board.tasks.filter((t) => t.status === status).map((t) => t.title);
}

async function card(id: string): Promise<TaskCard> {
  const board = await getBoard();
  const found = board.tasks.find((t) => t.id === id);
  if (!found) throw new Error(`task ${id} is not on the board`);
  return found;
}

async function activityTypes(taskId: string): Promise<string[]> {
  const rows = await prisma.activity.findMany({
    where: { taskId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { type: true },
  });
  return rows.map((r) => r.type);
}

async function counts() {
  const [tasks, labelRows, comments, items, activity] = await Promise.all([
    prisma.task.count(),
    prisma.label.count(),
    prisma.comment.count(),
    prisma.checklistItem.count(),
    prisma.activity.count(),
  ]);
  return { tasks, labels: labelRows, comments, items, activity, revision: await getRevision() };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe.skipIf(!RUN)("task service (Postgres)", () => {
  let owner: Actor;
  let owner2: Actor;

  beforeEach(async () => {
    await resetDatabase();
    owner = await makeUser("Harsh");
    owner2 = await makeUser("Priya");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("creating", () => {
    it("puts each new card at the top of its column", async () => {
      const a = data(await create(owner, { title: "A" }));
      const b = data(await create(owner, { title: "B" }));
      const c = data(await create(owner, { title: "C" }));
      expect(a.position).toBe(POSITION_STEP);
      expect(b.position).toBeLessThan(a.position);
      expect(c.position).toBeLessThan(b.position);
      expect(await titlesIn("TODO")).toEqual(["C", "B", "A"]);

      const done = data(await create(owner, { title: "Already done", status: "DONE" }));
      expect(done.completedAt).not.toBeNull();
      expect(done.createdById).toBe(owner.id);
      expect(done.version).toBe(1);
      expect(await activityTypes(done.id)).toEqual(["created"]);
    });

    it("keeps assignees in the order picked and labels sorted by name", async () => {
      const riya = await makeUser("Riya", "STAFF");
      const zed = data(await newLabel(owner, "Zed"));
      const bar = data(await newLabel(owner, "Bar"));
      const task = data(
        await create(owner, { title: "Order", assigneeIds: [riya.id, owner.id], labelIds: [zed.id, bar.id] }),
      );
      expect(task.assigneeIds).toEqual([riya.id, owner.id]);
      expect(task.labelIds).toEqual([bar.id, zed.id]);
    });

    it("refuses inactive or unknown assignees and writes nothing", async () => {
      const gone = await makeUser("Ghost", "STAFF", false);
      const before = await counts();

      const r = refused(await create(owner, { title: "X", assigneeIds: [gone.id] }), "INVALID");
      expect(r.error).toMatch(/Ghost/);
      refused(await create(owner, { title: "X", assigneeIds: ["no-such-user"] }), "INVALID");

      expect(await counts()).toEqual(before);
    });

    it("drops label ids that no longer exist", async () => {
      const kitchen = data(await newLabel(owner, "Kitchen"));
      const task = data(await create(owner, { title: "X", labelIds: [kitchen.id, "deleted-label"] }));
      expect(task.labelIds).toEqual([kitchen.id]);
    });
  });

  describe("moving", () => {
    it("moves between columns and reorders by neighbours", async () => {
      const a = data(await create(owner, { title: "A" }));
      const b = data(await create(owner, { title: "B" }));
      const c = data(await create(owner, { title: "C" }));

      data(await move(owner, a.id, "IN_PROGRESS"));
      expect(await titlesIn("IN_PROGRESS")).toEqual(["A"]);

      data(await move(owner, c.id, "IN_PROGRESS", a.id, null));
      expect(await titlesIn("IN_PROGRESS")).toEqual(["A", "C"]);

      data(await move(owner, b.id, "IN_PROGRESS", a.id, c.id));
      expect(await titlesIn("IN_PROGRESS")).toEqual(["A", "B", "C"]);
      expect(await titlesIn("TODO")).toEqual([]);

      // Reorder within the column: C to the top.
      data(await move(owner, c.id, "IN_PROGRESS", null, a.id));
      expect(await titlesIn("IN_PROGRESS")).toEqual(["C", "A", "B"]);

      // Only the change of column was recorded, not the reorder.
      const moves = (await activityTypes(c.id)).filter((t) => t === "moved");
      expect(moves).toHaveLength(1);
      const detail = await getTaskDetail(c.id);
      expect(detail?.activity.find((x) => x.type === "moved")?.detail).toEqual({ from: "TODO", to: "IN_PROGRESS" });
    });

    it("lands sensibly when a neighbour has gone or moved elsewhere", async () => {
      const a = data(await create(owner, { title: "A" }));
      const b = data(await create(owner, { title: "B" }));
      const x = data(await create(owner, { title: "X", status: "DONE" }));
      // TODO is [B, A]. "After X" is stale (X is in Done): fall back to "before A".
      const z = data(await create(owner, { title: "Z", status: "IN_PROGRESS" }));
      data(await move(owner, z.id, "TODO", x.id, a.id));
      expect(await titlesIn("TODO")).toEqual(["B", "Z", "A"]);

      // Both neighbours gone, aiming below something: the bottom.
      await prisma.task.delete({ where: { id: x.id } });
      data(await move(owner, b.id, "TODO", x.id, "also-gone"));
      expect(await titlesIn("TODO")).toEqual(["Z", "A", "B"]);
    });

    it("rebalances the column when the gap runs out, keeping the order", async () => {
      // TODO: [A, B] at 0 and 1024. Keep dropping a new card directly under A.
      const b = data(await create(owner, { title: "B" }));
      const a = data(await create(owner, { title: "A" }));
      expect(a.position).toBe(0);
      expect(b.position).toBe(POSITION_STEP);

      const inserted: string[] = [];
      for (let i = 1; i <= 40; i++) {
        const t = data(await create(owner, { title: `C${i}`, status: "DONE" }));
        const below = (await getBoard()).tasks.filter((x) => x.status === "TODO")[1];
        data(await move(owner, t.id, "TODO", a.id, below.id));
        inserted.unshift(`C${i}`);
      }

      expect(await titlesIn("TODO")).toEqual(["A", ...inserted, "B"]);
      const positions = (await getBoard()).tasks.filter((x) => x.status === "TODO").map((x) => x.position);
      for (let i = 1; i < positions.length; i++) expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      // A started at 0; only a rebalance renumbers it.
      expect((await card(a.id)).position).not.toBe(0);
      expect(Number.isInteger((await card(a.id)).position / POSITION_STEP)).toBe(true);
    });

    it("assigns the mover when an unassigned card enters In progress, and only then", async () => {
      const riya = await makeUser("Riya", "STAFF");
      const free = data(await create(owner, { title: "Free" }));
      const taken = data(await create(owner, { title: "Taken", assigneeIds: [riya.id] }));
      const straightToDone = data(await create(owner, { title: "Done" }));

      expect(data(await move(owner2, free.id, "IN_PROGRESS")).assigneeIds).toEqual([owner2.id]);
      expect(await activityTypes(free.id)).toEqual(["created", "moved", "assigned"]);

      expect(data(await move(owner2, taken.id, "IN_PROGRESS")).assigneeIds).toEqual([riya.id]);
      expect(data(await move(owner2, straightToDone.id, "DONE")).assigneeIds).toEqual([]);

      // Already in the column: a reorder is not "entering" it.
      const stillFree = data(await create(owner, { title: "Inside", status: "IN_PROGRESS" }));
      expect(data(await move(owner2, stillFree.id, "IN_PROGRESS", free.id, null)).assigneeIds).toEqual([]);
    });

    it("stamps completedAt entering Done and clears it on leaving", async () => {
      const t = data(await create(owner, { title: "T" }));
      expect(t.completedAt).toBeNull();
      const done = data(await move(owner, t.id, "DONE"));
      expect(done.completedAt).not.toBeNull();

      const other = data(await create(owner, { title: "Other", status: "DONE" }));
      const reordered = data(await move(owner, t.id, "DONE", other.id, null));
      expect(reordered.completedAt).toBe(done.completedAt);

      expect(data(await move(owner, t.id, "IN_PROGRESS")).completedAt).toBeNull();
    });

    it("does not touch the version, so an open edit still saves", async () => {
      const t = data(await create(owner, { title: "Before", assigneeIds: [owner.id] }));
      const moved = data(await move(owner2, t.id, "IN_PROGRESS"));
      expect(moved.version).toBe(t.version);
      expect(moved.updatedById).toBe(owner2.id);

      const saved = data(await update(owner, { id: t.id, version: t.version, title: "After" }));
      expect(saved.title).toBe("After");
      expect(saved.status).toBe("IN_PROGRESS");
    });

    it("refuses to move an archived card", async () => {
      const t = data(await create(owner, { title: "T" }));
      data(await svc.archiveTask(owner, t.id));
      refused(await move(owner, t.id, "DONE"), "INVALID");
      refused(await move(owner, "no-such-task", "DONE"), "NOT_FOUND");
    });
  });

  describe("editing", () => {
    it("tells the second of two editors, with the task as it now stands", async () => {
      const t = data(await create(owner, { title: "Chai order", description: "Original" }));

      const first = data(await update(owner, { id: t.id, version: t.version, title: "Chai order (Friday)" }));
      expect(first.version).toBe(t.version + 1);

      const second = refused(
        await update(owner2, { id: t.id, version: t.version, description: "Second editor's words" }),
        "CONFLICT",
      );
      expect(second.current?.title).toBe("Chai order (Friday)");
      expect(second.current?.version).toBe(first.version);
      expect(second.current?.description).toBe("Original");
      expect((await getTaskDetail(t.id))?.description).toBe("Original");
    });

    it("reports a vanished task as NOT_FOUND", async () => {
      const t = data(await create(owner, { title: "T" }));
      data(await svc.deleteTask(owner, t.id));
      refused(await update(owner, { id: t.id, version: 1, title: "x" }), "NOT_FOUND");
    });

    it("records each kind of change, by name for labels, and bumps the version once", async () => {
      const riya = await makeUser("Riya", "STAFF");
      const sam = await makeUser("Sam", "STAFF");
      const kitchen = data(await newLabel(owner, "Kitchen"));
      const bar = data(await newLabel(owner, "Bar"));
      const t = data(await create(owner, { title: "T", assigneeIds: [riya.id], labelIds: [kitchen.id] }));

      const saved = data(
        await update(owner2, {
          id: t.id,
          version: 1,
          title: "T2",
          description: "Now with words",
          priority: "URGENT",
          dueDate: "2026-10-20",
          assigneeIds: [sam.id],
          labelIds: [bar.id],
        }),
      );
      expect(saved.version).toBe(2);
      expect(saved.updatedById).toBe(owner2.id);
      expect(saved.dueDate).toBe("2026-10-20");
      expect(saved.assigneeIds).toEqual([sam.id]);
      expect(saved.labelIds).toEqual([bar.id]);

      const detail = await getTaskDetail(t.id);
      const byType = Object.fromEntries((detail?.activity ?? []).map((a) => [a.type, a.detail]));
      expect(byType.edited).toEqual({ fields: ["title", "description"] });
      expect(byType.priority_changed).toEqual({ from: "MEDIUM", to: "URGENT" });
      expect(byType.due_changed).toEqual({ from: null, to: "2026-10-20" });
      expect(byType.assigned).toEqual({ userIds: [sam.id] });
      expect(byType.unassigned).toEqual({ userIds: [riya.id] });
      expect(byType.labels_changed).toEqual({ added: ["Bar"], removed: ["Kitchen"] });
    });

    it("writes nothing for a save that changes nothing", async () => {
      const t = data(await create(owner, { title: "Same", dueDate: "2026-10-20" }));
      const before = await counts();
      const r = await update(owner, { id: t.id, version: 1, title: "  Same ", dueDate: "2026-10-20", assigneeIds: [] });
      expect(data(r).version).toBe(1);
      expect(r.ok && r.revision).toBe(before.revision);
      expect(await counts()).toEqual(before);
    });

    it("lets an assignee deactivated since stay, but not a new one be added", async () => {
      const riya = await makeUser("Riya", "STAFF");
      const sam = await makeUser("Sam", "STAFF", false);
      const t = data(await create(owner, { title: "T", assigneeIds: [riya.id] }));
      await prisma.user.update({ where: { id: riya.id }, data: { active: false } });

      const saved = data(await update(owner, { id: t.id, version: 1, assigneeIds: [riya.id, owner.id] }));
      expect(saved.assigneeIds).toEqual([riya.id, owner.id]);

      const r = refused(await update(owner, { id: t.id, version: 2, assigneeIds: [riya.id, sam.id] }), "INVALID");
      expect(r.error).toMatch(/Sam/);
    });
  });

  describe("the board revision", () => {
    it("goes up by exactly one on every write, and the result says where it is", async () => {
      expect(await getRevision()).toBe(0);
      let expected = 1;
      const step = async <T>(result: ActionResult<T>): Promise<T> => {
        const value = data(result);
        expect(result.ok && result.revision).toBe(expected);
        expect(await getRevision()).toBe(expected);
        expected++;
        return value;
      };

      const kitchen = await step(await newLabel(owner, "Kitchen"));
      const t = await step(await create(owner, { title: "T" }));
      await step(await update(owner, { id: t.id, version: 1, title: "T2" }));
      await step(await move(owner, t.id, "DONE"));
      await step(await move(owner, t.id, "TODO"));
      await step(await svc.joinTask(owner2, t.id));
      await step(await svc.leaveTask(owner2, t.id));
      const item = await step(await svc.addChecklistItem(owner, { taskId: t.id, text: "Milk" }));
      await step(await svc.updateChecklistItem(owner, { id: item.id, done: true }));
      await step(await svc.deleteChecklistItem(owner, item.id));
      const comment = await step(await svc.addComment(owner, { taskId: t.id, body: "Hi" }));
      await step(await svc.editComment(owner, { id: comment.id, body: "Hello" }));
      await step(await svc.deleteComment(owner, comment.id));
      await step(await labels.updateLabel(owner, updateLabelSchema.parse({ id: kitchen.id, color: "plum" })));
      await step(await svc.archiveTask(owner, t.id));
      await step(await svc.restoreTask(owner, t.id));
      await step(await move(owner, t.id, "DONE"));
      expect((await step(await svc.archiveDone(owner))).count).toBe(1);
      await step(await svc.deleteTask(owner, t.id));
      await step(await labels.deleteLabel(owner, kitchen.id));
    });

    it("serialises simultaneous writes, so each check sees the one before it", async () => {
      const a = await makeUser("Riya", "STAFF");
      const b = await makeUser("Sam", "STAFF");
      const t = data(await create(owner, { title: "Up for grabs" }));

      // Two staff press "I'll take this" at the same instant: exactly one gets it.
      const grabs = await Promise.all([svc.joinTask(a, t.id), svc.joinTask(b, t.id)]);
      expect(grabs.filter((r) => r.ok)).toHaveLength(1);
      expect(grabs.filter((r) => !r.ok && r.code === "FORBIDDEN")).toHaveLength(1);
      expect((await card(t.id)).assigneeIds).toHaveLength(1);

      // Two owners save from the same version at the same instant: one CONFLICT.
      const { version } = await card(t.id);
      const saves = await Promise.all([
        update(owner, { id: t.id, version, title: "One" }),
        update(owner2, { id: t.id, version, title: "Two" }),
      ]);
      expect(saves.filter((r) => r.ok)).toHaveLength(1);
      expect(saves.filter((r) => !r.ok && r.code === "CONFLICT")).toHaveLength(1);

      // Revisions handed back are distinct and end where the board is.
      const revisions = [...grabs, ...saves].flatMap((r) => (r.ok ? [r.revision] : []));
      expect(new Set(revisions).size).toBe(revisions.length);
      expect(Math.max(...revisions)).toBe(await getRevision());
    });

    it("does not move for refusals or no-ops", async () => {
      const t = data(await create(owner, { title: "T", assigneeIds: [owner.id] }));
      const before = await getRevision();
      refused(await update(owner, { id: t.id, version: 99, title: "x" }), "CONFLICT");
      refused(await svc.addComment(owner, { taskId: "nope", body: "x" }), "NOT_FOUND");
      expect(data(await svc.joinTask(owner, t.id)).assigneeIds).toEqual([owner.id]);
      data(await svc.leaveTask(owner2, t.id));
      expect((await svc.archiveDone(owner)).ok).toBe(true);
      expect(await getRevision()).toBe(before);
    });
  });

  describe("checklist and comments", () => {
    it("show as counts on the card without touching the version", async () => {
      const t = data(await create(owner, { title: "T" }));
      const one = data(await svc.addChecklistItem(owner, { taskId: t.id, text: "One" }));
      const two = data(await svc.addChecklistItem(owner, { taskId: t.id, text: "Two" }));
      data(await svc.addChecklistItem(owner, { taskId: t.id, text: "Three" }));
      expect(two.position).toBeGreaterThan(one.position);
      data(await svc.updateChecklistItem(owner2, { id: one.id, done: true }));
      data(await svc.addComment(owner, { taskId: t.id, body: "First" }));
      data(await svc.addComment(owner2, { taskId: t.id, body: "Second" }));

      const c = await card(t.id);
      expect(c.checklistDone).toBe(1);
      expect(c.checklistTotal).toBe(3);
      expect(c.commentCount).toBe(2);
      expect(c.version).toBe(1);
      expect(c.updatedById).toBe(owner2.id);

      const detail = await getTaskDetail(t.id);
      expect(detail?.checklist.map((i) => i.text)).toEqual(["One", "Two", "Three"]);
      expect(detail?.comments.map((x) => x.body)).toEqual(["First", "Second"]);
      expect(detail?.activity[0].type).toBe("commented");
      expect(detail?.activity.at(-1)?.type).toBe("created");
      expect(detail?.activity.find((a) => a.type === "checklist_checked")?.detail).toEqual({ text: "One" });
    });

    it("lets only the author edit a comment; the author or an owner delete it", async () => {
      const staff = await makeUser("Riya", "STAFF");
      const t = data(await create(owner, { title: "T" }));
      const mine = data(await svc.addComment(owner, { taskId: t.id, body: "Owner's" }));
      const theirs = data(await svc.addComment(staff, { taskId: t.id, body: "Staff's" }));
      const before = await counts();

      refused(await svc.editComment(owner2, { id: mine.id, body: "Hijacked" }), "FORBIDDEN");
      refused(await svc.editComment(owner, { id: theirs.id, body: "Hijacked" }), "FORBIDDEN");
      refused(await svc.deleteComment(staff, mine.id), "FORBIDDEN");
      expect(await counts()).toEqual(before);

      expect(data(await svc.editComment(staff, { id: theirs.id, body: "Edited" })).body).toBe("Edited");
      data(await svc.deleteComment(owner2, theirs.id));
      data(await svc.deleteComment(owner, mine.id));
      expect((await card(t.id)).commentCount).toBe(0);
    });
  });

  describe("labels", () => {
    it("are unique ignoring case", async () => {
      const kitchen = data(await newLabel(owner, "Kitchen"));
      const bar = data(await newLabel(owner, "Bar"));

      const r = refused(await newLabel(owner, "  kitchen "), "INVALID");
      expect(r.error).toBe("A label called “Kitchen” already exists.");
      refused(await labels.updateLabel(owner, updateLabelSchema.parse({ id: bar.id, name: "KITCHEN" })), "INVALID");

      // Its own name in a different case is fine.
      const renamed = data(await labels.updateLabel(owner, updateLabelSchema.parse({ id: kitchen.id, name: "kitchen" })));
      expect(renamed.name).toBe("kitchen");
      expect((await getBoard()).labels.map((l) => l.name)).toEqual(["Bar", "kitchen"]);
    });

    it("come off every task when deleted, while history still reads", async () => {
      const kitchen = data(await newLabel(owner, "Kitchen"));
      const t = data(await create(owner, { title: "T" }));
      data(await update(owner, { id: t.id, version: 1, labelIds: [kitchen.id] }));
      expect((await card(t.id)).labelIds).toEqual([kitchen.id]);

      data(await labels.deleteLabel(owner, kitchen.id));
      expect((await card(t.id)).labelIds).toEqual([]);
      const detail = await getTaskDetail(t.id);
      expect(detail?.activity.find((a) => a.type === "labels_changed")?.detail).toEqual({
        added: ["Kitchen"],
        removed: [],
      });
      refused(await labels.deleteLabel(owner, kitchen.id), "NOT_FOUND");
    });
  });

  describe("archive, restore and delete", () => {
    it("archives off the board and restores to the bottom of the column", async () => {
      const a = data(await create(owner, { title: "A" }));
      data(await create(owner, { title: "B" }));
      data(await svc.archiveTask(owner, a.id));
      expect(await titlesIn("TODO")).toEqual(["B"]);
      data(await create(owner, { title: "C" }));

      const archived = await getArchivedTasks();
      expect(archived.map((x) => x.title)).toEqual(["A"]);
      expect(archived[0].archivedAt).not.toBeNull();

      const restored = data(await svc.restoreTask(owner, a.id));
      expect(restored.archivedAt).toBeNull();
      expect(await titlesIn("TODO")).toEqual(["C", "B", "A"]);
      expect(await activityTypes(a.id)).toEqual(["created", "archived", "restored"]);
    });

    it("archives everything in Done at once, newest-archived first in the list", async () => {
      const old = data(await create(owner, { title: "Old", status: "DONE" }));
      data(await svc.archiveTask(owner, old.id));
      data(await create(owner, { title: "D1", status: "DONE" }));
      data(await create(owner, { title: "D2", status: "DONE" }));
      data(await create(owner, { title: "Open" }));

      expect(data(await svc.archiveDone(owner)).count).toBe(2);
      expect(await titlesIn("DONE")).toEqual([]);
      expect(await titlesIn("TODO")).toEqual(["Open"]);
      const list = (await getArchivedTasks()).map((x) => x.title);
      expect(list.at(-1)).toBe("Old");
      expect(list).toHaveLength(3);
    });

    it("deletes a task with everything hanging off it", async () => {
      const t = data(await create(owner, { title: "T", assigneeIds: [owner.id] }));
      data(await svc.addChecklistItem(owner, { taskId: t.id, text: "x" }));
      data(await svc.addComment(owner, { taskId: t.id, body: "x" }));
      data(await svc.deleteTask(owner, t.id));
      const c = await counts();
      expect([c.tasks, c.items, c.comments, c.activity]).toEqual([0, 0, 0, 0]);
      expect(await prisma.taskAssignee.count()).toBe(0);
      expect(await getTaskDetail(t.id)).toBeNull();
      refused(await svc.deleteTask(owner, t.id), "NOT_FOUND");
    });
  });

  describe("joining and leaving", () => {
    it("adds and removes the actor, bumping the version, and repeats harmlessly", async () => {
      const t = data(await create(owner, { title: "T" }));
      const joined = data(await svc.joinTask(owner2, t.id));
      expect(joined.assigneeIds).toEqual([owner2.id]);
      expect(joined.version).toBe(2);
      expect(data(await svc.joinTask(owner2, t.id)).version).toBe(2);

      const left = data(await svc.leaveTask(owner2, t.id));
      expect(left.assigneeIds).toEqual([]);
      expect(left.version).toBe(3);
      expect(data(await svc.leaveTask(owner2, t.id)).version).toBe(3);
      expect(await activityTypes(t.id)).toEqual(["created", "assigned", "unassigned"]);
    });
  });

  describe("board reads", () => {
    it("lists every member with their role, never a password hash or an email", async () => {
      await makeUser("Ali", "STAFF", false);
      const board = await getBoard();
      expect(board.members.map((m) => m.name)).toEqual(["Ali", "Harsh", "Priya"]);
      expect(board.members[0]).toMatchObject({ role: "STAFF", active: false });
      for (const m of board.members) expect(Object.keys(m).sort()).toEqual(["active", "avatar", "color", "id", "name", "role"]);
    });

    it("sorts tasks by column then position", async () => {
      const a = data(await create(owner, { title: "A", status: "DONE" }));
      data(await create(owner, { title: "B", status: "IN_PROGRESS" }));
      data(await create(owner, { title: "C" }));
      data(await create(owner, { title: "D" }));
      expect((await getBoard()).tasks.map((t) => t.title)).toEqual(["D", "C", "B", "A"]);
      expect((await getBoard()).tasks.find((t) => t.id === a.id)?.status).toBe("DONE");
    });
  });

  describe("staff", () => {
    let staff: Actor;
    let other: Actor;

    beforeEach(async () => {
      staff = await makeUser("Riya", "STAFF");
      other = await makeUser("Sam", "STAFF");
    });

    it("cannot create, edit, archive, restore, delete or manage labels — and nothing is written", async () => {
      const kitchen = data(await newLabel(owner, "Kitchen"));
      const t = data(await create(owner, { title: "T", assigneeIds: [staff.id] }));
      const archived = data(await create(owner, { title: "Old", status: "DONE" }));
      data(await svc.archiveTask(owner, archived.id));
      const before = await counts();

      expect(refused(await create(staff, { title: "Mine" }), "FORBIDDEN").error).toBe("Only owners can create tasks.");
      refused(await update(staff, { id: t.id, version: 1, title: "Renamed" }), "FORBIDDEN");
      refused(await update(staff, { id: t.id, version: 1, assigneeIds: [staff.id, other.id] }), "FORBIDDEN");
      refused(await svc.archiveTask(staff, t.id), "FORBIDDEN");
      refused(await svc.restoreTask(staff, archived.id), "FORBIDDEN");
      refused(await svc.archiveDone(staff), "FORBIDDEN");
      expect(refused(await svc.deleteTask(staff, t.id), "FORBIDDEN").error).toBe("Only owners can delete tasks.");
      refused(await newLabel(staff, "Bar"), "FORBIDDEN");
      refused(await labels.updateLabel(staff, updateLabelSchema.parse({ id: kitchen.id, name: "K" })), "FORBIDDEN");
      refused(await labels.deleteLabel(staff, kitchen.id), "FORBIDDEN");

      expect(await counts()).toEqual(before);
      expect((await card(t.id)).title).toBe("T");
    });

    it("moves only tasks they are on", async () => {
      const unclaimed = data(await create(owner, { title: "Unclaimed" }));
      const ownersTask = data(await create(owner, { title: "Owner's", assigneeIds: [owner.id] }));
      const mine = data(await create(owner, { title: "Mine", assigneeIds: [staff.id] }));
      const before = await counts();

      expect(refused(await move(staff, unclaimed.id, "IN_PROGRESS"), "FORBIDDEN").error).toMatch(/Pick this task up/);
      refused(await move(staff, ownersTask.id, "DONE"), "FORBIDDEN");
      expect(await counts()).toEqual(before);
      expect((await card(unclaimed.id)).status).toBe("TODO");

      const moved = data(await move(staff, mine.id, "IN_PROGRESS"));
      expect(moved.status).toBe("IN_PROGRESS");
      expect(moved.assigneeIds).toEqual([staff.id]);
      expect(data(await move(staff, mine.id, "DONE")).completedAt).not.toBeNull();
    });

    it("works the checklist only on tasks they are on", async () => {
      const theirs = data(await create(owner, { title: "Theirs", assigneeIds: [other.id] }));
      const mine = data(await create(owner, { title: "Mine", assigneeIds: [staff.id] }));
      const theirItem = data(await svc.addChecklistItem(owner, { taskId: theirs.id, text: "Theirs" }));

      refused(await svc.addChecklistItem(staff, { taskId: theirs.id, text: "x" }), "FORBIDDEN");
      refused(await svc.updateChecklistItem(staff, { id: theirItem.id, done: true }), "FORBIDDEN");
      refused(await svc.deleteChecklistItem(staff, theirItem.id), "FORBIDDEN");

      const item = data(await svc.addChecklistItem(staff, { taskId: mine.id, text: "Milk" }));
      expect(data(await svc.updateChecklistItem(staff, { id: item.id, done: true, text: "Oat milk" }))).toMatchObject({
        done: true,
        text: "Oat milk",
      });
      data(await svc.deleteChecklistItem(staff, item.id));
      expect((await card(theirs.id)).checklistDone).toBe(0);
    });

    it("can pick up unclaimed work that is not done, but not a done or claimed task", async () => {
      const todo = data(await create(owner, { title: "Todo" }));
      const doing = data(await create(owner, { title: "Doing", status: "IN_PROGRESS" }));
      const done = data(await create(owner, { title: "Done", status: "DONE" }));
      const claimed = data(await create(owner, { title: "Claimed", assigneeIds: [other.id] }));

      expect(data(await svc.joinTask(staff, todo.id)).assigneeIds).toEqual([staff.id]);
      expect(data(await svc.joinTask(staff, doing.id)).assigneeIds).toEqual([staff.id]);
      expect(refused(await svc.joinTask(staff, done.id), "FORBIDDEN").error).toMatch(/already done/);
      expect(refused(await svc.joinTask(staff, claimed.id), "FORBIDDEN").error).toMatch(/Someone is already on/);

      // Once on it, they can work it — and step off it.
      data(await move(staff, todo.id, "IN_PROGRESS"));
      expect(data(await svc.leaveTask(staff, todo.id)).assigneeIds).toEqual([]);
      // An owner may join anything.
      expect(data(await svc.joinTask(owner, claimed.id)).assigneeIds).toEqual([other.id, owner.id]);
    });

    it("comments anywhere, and deletes only their own comments", async () => {
      const t = data(await create(owner, { title: "T", assigneeIds: [owner.id] }));
      const ownerComment = data(await svc.addComment(owner, { taskId: t.id, body: "From the owner" }));
      const staffComment = data(await svc.addComment(staff, { taskId: t.id, body: "From staff" }));

      expect(refused(await svc.deleteComment(staff, ownerComment.id), "FORBIDDEN").error).toBe(
        "You can only delete your own comments.",
      );
      refused(await svc.editComment(staff, { id: ownerComment.id, body: "x" }), "FORBIDDEN");
      data(await svc.deleteComment(owner, staffComment.id));
      const mine = data(await svc.addComment(staff, { taskId: t.id, body: "Again" }));
      data(await svc.deleteComment(staff, mine.id));
      expect((await card(t.id)).commentCount).toBe(1);
    });

    it("sees the same board an owner does", async () => {
      data(await create(owner, { title: "T", assigneeIds: [other.id] }));
      const board = await getBoard();
      expect(board.tasks).toHaveLength(1);
      expect(board.members.find((m) => m.id === staff.id)?.role).toBe("STAFF");
    });

    it("cannot touch an archived task even if they are on it", async () => {
      const t = data(await create(owner, { title: "T", assigneeIds: [staff.id] }));
      const item = data(await svc.addChecklistItem(staff, { taskId: t.id, text: "x" }));
      data(await svc.archiveTask(owner, t.id));
      refused(await move(staff, t.id, "DONE"), "INVALID");
      refused(await svc.updateChecklistItem(staff, { id: item.id, done: true }), "INVALID");
      refused(await svc.addComment(staff, { taskId: t.id, body: "x" }), "INVALID");
      refused(await svc.leaveTask(staff, t.id), "INVALID");
    });
  });

  describe("who is acting, read under the lock", () => {
    it("refuses a write from an account deactivated before it ran", async () => {
      const owner = await makeUser("Olivia");
      const staff = await makeUser("Sam", "STAFF");
      const t = data(await create(owner, { title: "Unclaimed" }));
      // The session said active when the request began; by the time the write
      // holds the lock the account has been switched off.
      await prisma.user.update({ where: { id: staff.id }, data: { active: false } });
      refused(await svc.joinTask(staff, t.id), "UNAUTHORIZED");
      expect((await card(t.id)).assigneeIds).toEqual([]);
    });

    it("checks an owner's action against their role now, not when the request began", async () => {
      const owner = await makeUser("Olivia");
      const demoted = await makeUser("Dev");
      await prisma.user.update({ where: { id: demoted.id }, data: { role: "STAFF" } });
      // `demoted` still says OWNER, as a session read a moment earlier would.
      refused(await create(demoted, { title: "Sneaky" }), "FORBIDDEN");
      refused(await newLabel(demoted, "Sneaky"), "FORBIDDEN");
      const t = data(await create(owner, { title: "T" }));
      refused(await svc.deleteTask(demoted, t.id), "FORBIDDEN");
      refused(await update(demoted, { id: t.id, version: t.version, title: "x" }), "FORBIDDEN");
    });
  });

  describe("picking a card up by moving it", () => {
    it("moves the version, so an owner's open edit of the people is told rather than undoing it", async () => {
      const alice = await makeUser("Alice");
      const bob = await makeUser("Bob");
      const cara = await makeUser("Cara");
      const t = data(await create(alice, { title: "Unassigned" }));

      const moved = data(await move(bob, t.id, "IN_PROGRESS"));
      expect(moved.assigneeIds).toEqual([bob.id]);
      expect(moved.version).toBe(t.version + 1);

      // Alice saves from the version she opened, which no longer has Bob in it.
      const stale = refused(await update(alice, { id: t.id, version: t.version, assigneeIds: [cara.id] }), "CONFLICT");
      expect(stale.current?.assigneeIds).toEqual([bob.id]);
    });

    it("still leaves the version alone for a plain move", async () => {
      const owner = await makeUser("Olivia");
      const t = data(await create(owner, { title: "T", assigneeIds: [owner.id] }));
      expect(data(await move(owner, t.id, "IN_PROGRESS")).version).toBe(t.version);
    });
  });

  describe("what the board tells every account", () => {
    it("leaves out email addresses", async () => {
      await makeUser("Sam", "STAFF");
      const board = await getBoard();
      expect(board.members.length).toBeGreaterThan(1);
      for (const member of board.members) expect(member).not.toHaveProperty("email");
    });
  });
});
