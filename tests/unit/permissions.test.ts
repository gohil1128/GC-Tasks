import { describe, expect, it } from "vitest";
import {
  canArchiveOrDelete,
  canComment,
  canCreateTask,
  canDeleteComment,
  canEditComment,
  canEditTask,
  canJoinTask,
  canLeaveTask,
  canManageLabels,
  canManageTeam,
  canMoveTask,
  canWorkChecklist,
  type Actor,
  type TaskAccess,
} from "@/lib/permissions";

const owner: Actor = { id: "o1", role: "OWNER" };
const staff: Actor = { id: "s1", role: "STAFF" };

const task = (over: Partial<TaskAccess> = {}): TaskAccess => ({
  assigneeIds: [],
  status: "TODO",
  archivedAt: null,
  ...over,
});

describe("owners", () => {
  it("can do everything on a live task", () => {
    const t = task({ assigneeIds: ["someone-else"] });
    expect(canCreateTask(owner)).toBe(true);
    expect(canEditTask(owner)).toBe(true);
    expect(canMoveTask(owner, t)).toBe(true);
    expect(canJoinTask(owner, t)).toBe(true);
    expect(canWorkChecklist(owner, t)).toBe(true);
    expect(canArchiveOrDelete(owner)).toBe(true);
    expect(canManageLabels(owner)).toBe(true);
    expect(canManageTeam(owner)).toBe(true);
  });

  it("can delete anyone's comment but only edit their own", () => {
    expect(canDeleteComment(owner, { authorId: "s1" })).toBe(true);
    expect(canEditComment(owner, { authorId: "s1" })).toBe(false);
    expect(canEditComment(owner, { authorId: "o1" })).toBe(true);
  });
});

describe("staff", () => {
  it("cannot create, edit, archive, or manage labels or the team", () => {
    expect(canCreateTask(staff)).toBe(false);
    expect(canEditTask(staff)).toBe(false);
    expect(canArchiveOrDelete(staff)).toBe(false);
    expect(canManageLabels(staff)).toBe(false);
    expect(canManageTeam(staff)).toBe(false);
  });

  it("moves and works the checklist only on tasks they are on", () => {
    const mine = task({ assigneeIds: ["s1", "o1"] });
    const theirs = task({ assigneeIds: ["o1"] });
    expect(canMoveTask(staff, mine)).toBe(true);
    expect(canWorkChecklist(staff, mine)).toBe(true);
    expect(canMoveTask(staff, theirs)).toBe(false);
    expect(canWorkChecklist(staff, theirs)).toBe(false);
  });

  it("can pick up unclaimed work that is not done", () => {
    expect(canJoinTask(staff, task())).toBe(true);
    expect(canJoinTask(staff, task({ status: "IN_PROGRESS" }))).toBe(true);
    expect(canJoinTask(staff, task({ status: "DONE" }))).toBe(false);
    expect(canJoinTask(staff, task({ assigneeIds: ["o1"] }))).toBe(false);
  });

  it("can leave only a task they are on", () => {
    expect(canLeaveTask(staff, task({ assigneeIds: ["s1"] }))).toBe(true);
    expect(canLeaveTask(staff, task({ assigneeIds: ["o1"] }))).toBe(false);
  });

  it("comments anywhere, edits and deletes only their own comments", () => {
    expect(canComment(staff, task({ assigneeIds: ["o1"] }))).toBe(true);
    expect(canEditComment(staff, { authorId: "s1" })).toBe(true);
    expect(canDeleteComment(staff, { authorId: "s1" })).toBe(true);
    expect(canDeleteComment(staff, { authorId: "o1" })).toBe(false);
  });
});

describe("archived tasks", () => {
  it("are frozen for everyone except owners restoring or deleting them", () => {
    const archived = task({ assigneeIds: ["s1", "o1"], archivedAt: "2026-10-01T00:00:00.000Z" });
    for (const actor of [owner, staff]) {
      expect(canMoveTask(actor, archived)).toBe(false);
      expect(canWorkChecklist(actor, archived)).toBe(false);
      expect(canJoinTask(actor, archived)).toBe(false);
      expect(canLeaveTask(actor, archived)).toBe(false);
      expect(canComment(actor, archived)).toBe(false);
    }
    expect(canArchiveOrDelete(owner)).toBe(true);
  });
});
