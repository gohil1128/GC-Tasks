/*
  Who may do what — the one place the line between owners and staff is drawn.

  Owners run the board: they create, edit, assign, archive and delete tasks,
  manage labels, and manage the team (including whether people may sign
  themselves up).

  Staff see the tasks nobody has claimed and the tasks other staff are on,
  but not what the owners are working on: a task with an owner among its
  assignees is hidden from them unless they are on it too (canSeeTask).
  What they can see, they only WORK. They can:
    - move a task they are assigned to (To do → In progress → Done),
    - tick, add, rename and remove checklist items on a task they are on,
    - pick up an unclaimed task ("I'll take this") that is not already done,
      and step off a task they are on,
    - comment on any task they can see, and edit or delete their own comments.
  They cannot create, retitle, re-prioritise, re-date, re-label, reassign,
  archive or delete tasks, and cannot touch labels or the team.

  Ideas (the Reddit-style page beside the board) are everyone's: anyone may
  share an idea, reply anywhere in a thread, and upvote other people's posts
  once each. People edit and delete only their own posts; owners may delete
  anyone's.

  These functions are pure and import nothing server-only, so the browser
  uses the same rules to decide which controls to show. That is a courtesy:
  every Server Action checks again on the server, because a hidden button
  stops nobody who can shape a request.
*/

export const ROLES = ["OWNER", "STAFF"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  STAFF: "Staff",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  OWNER: "Full access: creates, edits, assigns and deletes tasks, and manages labels and the team.",
  STAFF: "Moves and updates the tasks they're on, picks up unclaimed tasks, and comments.",
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export type Actor = { id: string; role: Role };

/** The parts of a task a permission depends on. TaskCard satisfies it. */
export type TaskAccess = {
  assigneeIds: string[];
  status: "TODO" | "IN_PROGRESS" | "DONE";
  archivedAt: string | Date | null;
};

export function isOwner(actor: Actor): boolean {
  return actor.role === "OWNER";
}

function isOn(actor: Actor, task: TaskAccess): boolean {
  return task.assigneeIds.includes(actor.id);
}

/** The people on a task, with each one's role as it stands NOW. */
export type TaskVisibility = { assignees: Array<{ id: string; role: Role }> };

/**
  Owners see everything. Staff see a task they are on, or one with no owner
  on it — unclaimed work stays visible so they can pick it up. The role is
  the assignee's current one, so demoting an owner reveals their tasks.

  The same rule as a database filter is visibleTaskWhere() in
  modules/tasks/visibility.ts; the two must agree.
*/
export function canSeeTask(actor: Actor, task: TaskVisibility): boolean {
  if (isOwner(actor)) return true;
  if (task.assignees.some((a) => a.id === actor.id)) return true;
  return !task.assignees.some((a) => a.role === "OWNER");
}

export function canCreateTask(actor: Actor): boolean {
  return isOwner(actor);
}

/** Title, description, priority, due date, labels and assignees. */
export function canEditTask(actor: Actor): boolean {
  return isOwner(actor);
}

export function canMoveTask(actor: Actor, task: TaskAccess): boolean {
  if (task.archivedAt) return false;
  return isOwner(actor) || isOn(actor, task);
}

/**
  Staff may claim work nobody has claimed. Not a task that is already done
  (there is nothing left to pick up), and not one somebody is already on
  (joining someone else's task is the owner's call to make).
*/
export function canJoinTask(actor: Actor, task: TaskAccess): boolean {
  if (task.archivedAt || isOn(actor, task)) return false;
  if (isOwner(actor)) return true;
  return task.assigneeIds.length === 0 && task.status !== "DONE";
}

export function canLeaveTask(actor: Actor, task: TaskAccess): boolean {
  return !task.archivedAt && isOn(actor, task);
}

export function canWorkChecklist(actor: Actor, task: TaskAccess): boolean {
  if (task.archivedAt) return false;
  return isOwner(actor) || isOn(actor, task);
}

export function canComment(actor: Actor, task: TaskAccess): boolean {
  void actor;
  return !task.archivedAt;
}

export function canEditComment(actor: Actor, comment: { authorId: string }): boolean {
  return comment.authorId === actor.id;
}

/** Your own, or anyone's if you are an owner — owners keep the board tidy. */
export function canDeleteComment(actor: Actor, comment: { authorId: string }): boolean {
  return comment.authorId === actor.id || isOwner(actor);
}

/** Archive, restore, archive-all-done and delete. */
export function canArchiveOrDelete(actor: Actor): boolean {
  return isOwner(actor);
}

export function canManageLabels(actor: Actor): boolean {
  return isOwner(actor);
}

export function canManageTeam(actor: Actor): boolean {
  return isOwner(actor);
}

/**
  Opening and closing self sign-up. Its own rule, though owners-only like
  the rest of the team: an open sign-up lets anyone with the link join as
  staff and see the whole board.
*/
export function canManageSignups(actor: Actor): boolean {
  return isOwner(actor);
}

// ── Ideas ────────────────────────────────────────────────────────────────

/**
  The parts of an idea or reply a permission depends on. `deleted` is a post
  left in its thread as "[deleted]" because it still has replies; nothing
  more can be done to it.
*/
export type IdeaAccess = { authorId: string | null; deleted: boolean };

/** Every signed-in, active account may share an idea. */
export function canShareIdea(actor: Actor): boolean {
  void actor;
  return true;
}

export function canReplyToIdea(actor: Actor, post: IdeaAccess): boolean {
  void actor;
  return !post.deleted;
}

/** The author only — owners included, so nobody's words are put in their mouth. */
export function canEditIdea(actor: Actor, post: IdeaAccess): boolean {
  return !post.deleted && post.authorId === actor.id;
}

/** Your own, or anyone's if you are an owner — the same as task comments. */
export function canDeleteIdea(actor: Actor, post: IdeaAccess): boolean {
  return !post.deleted && (post.authorId === actor.id || isOwner(actor));
}

/** Upvotes only, one each, and never on your own post. */
export function canVoteIdea(actor: Actor, post: IdeaAccess): boolean {
  return !post.deleted && post.authorId !== null && post.authorId !== actor.id;
}
