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
  canManageSignups,
  canManageTeam,
  canMoveTask,
  canWorkChecklist,
  canDeleteIdea,
  canEditIdea,
  canReplyToIdea,
  canShareIdea,
  canVoteIdea,
  type Actor,
  type IdeaAccess,
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
    expect(canManageSignups(owner)).toBe(true);
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
    expect(canManageSignups(staff)).toBe(false);
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

describe("ideas", () => {
  const post = (over: Partial<IdeaAccess> = {}): IdeaAccess => ({ authorId: "s1", deleted: false, ...over });

  it("lets everyone share and reply", () => {
    for (const actor of [owner, staff]) {
      expect(canShareIdea(actor)).toBe(true);
      expect(canReplyToIdea(actor, post({ authorId: "someone-else" }))).toBe(true);
    }
  });

  it("lets only the author edit, owners included", () => {
    expect(canEditIdea(staff, post())).toBe(true);
    expect(canEditIdea(owner, post())).toBe(false);
    expect(canEditIdea(staff, post({ authorId: "o1" }))).toBe(false);
  });

  it("lets the author or any owner delete", () => {
    expect(canDeleteIdea(staff, post())).toBe(true);
    expect(canDeleteIdea(owner, post())).toBe(true);
    expect(canDeleteIdea(staff, post({ authorId: "o1" }))).toBe(false);
  });

  it("allows upvoting others' posts but not your own", () => {
    expect(canVoteIdea(owner, post())).toBe(true);
    expect(canVoteIdea(staff, post())).toBe(false);
    expect(canVoteIdea(staff, post({ authorId: "o1" }))).toBe(true);
  });

  it("freezes a deleted post for everyone", () => {
    const gone = post({ deleted: true, authorId: null });
    for (const actor of [owner, staff]) {
      expect(canReplyToIdea(actor, gone)).toBe(false);
      expect(canEditIdea(actor, gone)).toBe(false);
      expect(canDeleteIdea(actor, gone)).toBe(false);
      expect(canVoteIdea(actor, gone)).toBe(false);
    }
  });
});
