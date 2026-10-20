import type { Prisma } from "@prisma/client";
import { formatDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import {
  canArchiveOrDelete,
  canComment,
  canCreateTask,
  canDeleteComment,
  canEditComment,
  canEditTask,
  canJoinTask,
  canLeaveTask,
  canMoveTask,
  canWorkChecklist,
  type Actor,
  type TaskAccess,
} from "@/lib/permissions";
import {
  checklistItemSelect,
  commentSelect,
  taskCardSelect,
  toChecklistItem,
  toComment,
  toTaskCard,
} from "@/modules/tasks/mappers";
import { insertionIndex, placeInColumn, positionBetween, rebalancedPositions } from "@/modules/tasks/position";
import { captureActivity } from "@/modules/notifications/context";
import { readTaskDetail } from "@/modules/tasks/queries";
import { boardWrite, changed, refuse, unchanged } from "@/modules/tasks/revision";
import type {
  ActionResult,
  ActivityType,
  ChecklistItemDTO,
  CommentDTO,
  ErrorCode,
  TaskCard,
} from "@/modules/tasks/types";
import type {
  AddChecklistItemData,
  AddCommentData,
  CreateTaskData,
  EditCommentData,
  MoveTaskData,
  UpdateChecklistItemData,
  UpdateTaskData,
} from "@/modules/tasks/validation";

/*
  The task domain: every board write, as a function of who is acting and an
  already-validated input. The Server Actions are thin wrappers around these
  (session → zod → here), and the integration tests call them directly.

  Each function runs as one boardWrite() — one transaction that holds the
  board lock, re-reads the task, checks the permission against what it reads
  (never against what the browser believed), writes, records the activity
  and bumps the revision. A refusal throws inside the transaction so nothing
  is left half-done, and comes back out as { ok:false }.

  The actor too is re-read inside the transaction, after the lock: each
  write's callback takes a fresh `actor` from boardWrite() that shadows the
  one the function was called with, on purpose, so every check below — the
  role-only ones (owners create, edit, archive, delete) included — runs
  against who the person is now, not who they were when the request began.
*/

type Tx = Prisma.TransactionClient;

const MSG = {
  taskGone: "This task no longer exists. Someone may have deleted it.",
  archived: "This task is archived. Restore it before changing it.",
  editedElsewhere: "Someone else saved changes to this task while you were editing. Here is the latest version.",
  itemGone: "That checklist item no longer exists.",
  commentGone: "That comment no longer exists.",
} as const;

function fail<T>(code: ErrorCode, error: string): ActionResult<T> {
  return { ok: false, code, error };
}

// ── Shared steps ───────────────────────────────────────────────────────────

/** The task as a permission sees it, read inside the transaction. */
async function loadAccess(tx: Tx, id: string): Promise<TaskAccess & { id: string }> {
  const row = await tx.task.findUnique({
    where: { id },
    select: { id: true, status: true, archivedAt: true, assignees: { select: { userId: true } } },
  });
  if (!row) refuse("NOT_FOUND", MSG.taskGone);
  return { id: row.id, status: row.status, archivedAt: row.archivedAt, assigneeIds: row.assignees.map((a) => a.userId) };
}

/**
  Archived tasks are frozen for everyone (permissions.ts). Checked before the
  person's own permission so the refusal says WHY — "it's archived", not
  "you're not allowed".
*/
function assertLive(task: Pick<TaskAccess, "archivedAt">): void {
  if (task.archivedAt) refuse("INVALID", MSG.archived);
}

async function readCard(tx: Tx, id: string): Promise<TaskCard> {
  return toTaskCard(await tx.task.findUniqueOrThrow({ where: { id }, select: taskCardSelect }));
}

async function log(
  tx: Tx,
  taskId: string,
  actorId: string,
  entries: Array<[ActivityType, Prisma.InputJsonObject?]>,
): Promise<void> {
  if (entries.length === 0) return;
  await tx.activity.createMany({
    data: entries.map(([type, detail]) => ({ taskId, actorId, type, detail: detail ?? {} })),
  });
  // A copy for the notifier, which boardWrite() releases only if this
  // transaction commits (see modules/notifications/context.ts).
  for (const [type, detail] of entries) {
    captureActivity({ taskId, actorId, type, detail: (detail ?? {}) as Record<string, unknown> });
  }
}

/**
  Assignment rows stamped from one clock, a millisecond apart, so several
  people added in one save keep the order they were picked in ("in the order
  they were assigned" is how cards list them).
*/
function assignmentRows(taskId: string, userIds: string[]) {
  const base = Date.now();
  return userIds.map((userId, i) => ({ taskId, userId, assignedAt: new Date(base + i) }));
}

/**
  New assignees must be real, active accounts: assigning work to someone who
  cannot sign in is a mistake worth saying out loud, not quietly dropping.
*/
async function assertAssignable(tx: Tx, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const users = await tx.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, active: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  for (const id of userIds) {
    const user = byId.get(id);
    if (!user) refuse("INVALID", "One of the people picked is not on the team. Reload and try again.");
    if (!user.active) refuse("INVALID", `${user.name}'s account is deactivated, so they can't be assigned.`);
  }
}

/**
  The labels among `ids` that still exist, in the order asked. Unknown ids
  are dropped rather than refused: the usual cause is another owner deleting
  a label while this dialog was open, and "the task does not carry a label
  that no longer exists" is what either of them would want.
*/
async function existingLabels(tx: Tx, ids: string[]): Promise<Array<{ id: string; name: string }>> {
  if (ids.length === 0) return [];
  const rows = await tx.label.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const byId = new Map(rows.map((l) => [l.id, l]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/** Checklist and comment changes show on the card, so the task records who touched it last. */
async function touch(tx: Tx, taskId: string, actorId: string): Promise<void> {
  await tx.task.update({ where: { id: taskId }, data: { updatedById: actorId }, select: { id: true } });
}

/**
  Renumber a column STEP, 2·STEP, … in its current order, in one statement —
  it can be a long column, and one round trip per card would not be.
*/
async function rebalanceColumn(tx: Tx, orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  const positions = rebalancedPositions(orderedIds.length);
  await tx.$executeRaw`
    UPDATE "Task" AS t
    SET "position" = v.position
    FROM unnest(${orderedIds}::text[], ${positions}::double precision[]) AS v(id, position)
    WHERE t."id" = v.id`;
}

// ── Tasks ──────────────────────────────────────────────────────────────────

/** New tasks go to the TOP of their column. */
export async function createTask(actor: Actor, input: CreateTaskData): Promise<ActionResult<TaskCard>> {
  return boardWrite(actor, async (tx, actor) => {
    if (!canCreateTask(actor)) refuse("FORBIDDEN", "Only owners can create tasks.");
    await assertAssignable(tx, input.assigneeIds);
    const labels = await existingLabels(tx, input.labelIds);
    const top = await tx.task.aggregate({
      where: { status: input.status, archivedAt: null },
      _min: { position: true },
    });
    const task = await tx.task.create({
      data: {
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        dueDate: input.dueDate,
        position: positionBetween(null, top._min.position),
        completedAt: input.status === "DONE" ? new Date() : null,
        createdById: actor.id,
        updatedById: actor.id,
      },
      select: { id: true },
    });
    if (input.assigneeIds.length) {
      await tx.taskAssignee.createMany({ data: assignmentRows(task.id, input.assigneeIds) });
    }
    if (labels.length) {
      await tx.taskLabel.createMany({ data: labels.map((l) => ({ taskId: task.id, labelId: l.id })) });
    }
    await log(tx, task.id, actor.id, [["created"]]);
    return changed(await readCard(tx, task.id));
  });
}

/**
  Optimistic concurrency: `version` is what the editor started from. If the
  task has moved on, nothing is written and the result is a CONFLICT carrying
  the task as it now stands. Only fields that actually differ count; a save
  that changes nothing writes nothing and keeps the version.
*/
export async function updateTask(actor: Actor, input: UpdateTaskData): Promise<ActionResult<TaskCard>> {
  const result = await boardWrite(actor, async (tx, actor) => {
    if (!canEditTask(actor)) refuse("FORBIDDEN", "Only owners can edit tasks.");
    const task = await tx.task.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        title: true,
        description: true,
        priority: true,
        dueDate: true,
        version: true,
        archivedAt: true,
        assignees: { select: { userId: true } },
        labels: { select: { labelId: true, label: { select: { name: true } } } },
      },
    });
    if (!task) refuse("NOT_FOUND", MSG.taskGone);
    assertLive(task);
    if (task.version !== input.version) refuse("CONFLICT", MSG.editedElsewhere);

    const data: Prisma.TaskUpdateManyMutationInput = {};
    const activity: Array<[ActivityType, Prisma.InputJsonObject]> = [];

    const edited: string[] = [];
    if (input.title !== undefined && input.title !== task.title) {
      data.title = input.title;
      edited.push("title");
    }
    if (input.description !== undefined && input.description !== task.description) {
      data.description = input.description;
      edited.push("description");
    }
    if (edited.length) activity.push(["edited", { fields: edited }]);

    if (input.priority !== undefined && input.priority !== task.priority) {
      data.priority = input.priority;
      activity.push(["priority_changed", { from: task.priority, to: input.priority }]);
    }

    if (input.dueDate !== undefined) {
      const from = task.dueDate ? formatDay(task.dueDate) : null;
      const to = input.dueDate ? formatDay(input.dueDate) : null;
      if (from !== to) {
        data.dueDate = input.dueDate;
        activity.push(["due_changed", { from, to }]);
      }
    }

    let addUsers: string[] = [];
    let removeUsers: string[] = [];
    if (input.assigneeIds !== undefined) {
      const wanted = input.assigneeIds;
      const current = task.assignees.map((a) => a.userId);
      addUsers = wanted.filter((id) => !current.includes(id));
      removeUsers = current.filter((id) => !wanted.includes(id));
      // Only the newly added are checked: someone deactivated since they were
      // assigned can stay on the task without blocking every other edit.
      await assertAssignable(tx, addUsers);
      if (addUsers.length) activity.push(["assigned", { userIds: addUsers }]);
      if (removeUsers.length) activity.push(["unassigned", { userIds: removeUsers }]);
    }

    let addLabels: Array<{ id: string; name: string }> = [];
    let removeLabelIds: string[] = [];
    if (input.labelIds !== undefined) {
      const wanted = await existingLabels(tx, input.labelIds);
      addLabels = wanted.filter((l) => !task.labels.some((c) => c.labelId === l.id));
      const removed = task.labels.filter((c) => !wanted.some((l) => l.id === c.labelId));
      removeLabelIds = removed.map((c) => c.labelId);
      if (addLabels.length || removed.length) {
        activity.push([
          "labels_changed",
          { added: addLabels.map((l) => l.name), removed: removed.map((c) => c.label.name) },
        ]);
      }
    }

    if (activity.length === 0) return unchanged(await readCard(tx, task.id));

    // The version is re-checked by the write itself; under the board lock
    // this cannot miss, but it is what makes the check atomic regardless.
    const written = await tx.task.updateMany({
      where: { id: task.id, version: input.version },
      data: { ...data, version: { increment: 1 }, updatedById: actor.id },
    });
    if (written.count === 0) refuse("CONFLICT", MSG.editedElsewhere);

    if (removeUsers.length) {
      await tx.taskAssignee.deleteMany({ where: { taskId: task.id, userId: { in: removeUsers } } });
    }
    if (addUsers.length) await tx.taskAssignee.createMany({ data: assignmentRows(task.id, addUsers) });
    if (removeLabelIds.length) {
      await tx.taskLabel.deleteMany({ where: { taskId: task.id, labelId: { in: removeLabelIds } } });
    }
    if (addLabels.length) {
      await tx.taskLabel.createMany({ data: addLabels.map((l) => ({ taskId: task.id, labelId: l.id })) });
    }
    await log(tx, task.id, actor.id, activity);
    return changed(await readCard(tx, task.id));
  });

  // Read after the rollback, so the dialog is shown what actually won.
  if (!result.ok && result.code === "CONFLICT") {
    const current = await readTaskDetail(prisma, input.id);
    if (!current) return fail("NOT_FOUND", MSG.taskGone);
    return { ...result, current };
  }
  return result;
}

function moveRefusal(actor: Actor, task: TaskAccess): string {
  return canJoinTask(actor, task)
    ? "Pick this task up first, then you can move it."
    : "You can only move tasks you're on.";
}

/**
  Drop a card into a column between two neighbours. Does not check or bump
  the version: dragging a card must not invalidate an edit somebody else has
  open. Entering DONE stamps completedAt and leaving it clears it; dragging an
  unassigned card INTO In progress assigns whoever moved it. Reordering within
  a column records no activity.
*/
export async function moveTask(actor: Actor, input: MoveTaskData): Promise<ActionResult<TaskCard>> {
  return boardWrite(actor, async (tx, actor) => {
    const task = await loadAccess(tx, input.id);
    assertLive(task);
    if (!canMoveTask(actor, task)) refuse("FORBIDDEN", moveRefusal(actor, task));

    const column = await tx.task.findMany({
      where: { status: input.status, archivedAt: null, id: { not: task.id } },
      select: { id: true, position: true },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    const index = insertionIndex(column, input.afterId, input.beforeId);
    const { position, rebalance } = placeInColumn(column, index);
    if (rebalance) await rebalanceColumn(tx, column.map((c) => c.id));

    const from = task.status;
    const to = input.status;
    const statusChanged = from !== to;
    const autoAssign = statusChanged && to === "IN_PROGRESS" && task.assigneeIds.length === 0;

    let completedAt: Date | null | undefined;
    if (statusChanged && to === "DONE") completedAt = new Date();
    else if (statusChanged && from === "DONE") completedAt = null;

    await tx.task.update({
      where: { id: task.id },
      data: {
        status: to,
        position,
        updatedById: actor.id,
        ...(completedAt !== undefined ? { completedAt } : {}),
        // Picking the card up adds a person, and people are content: an owner
        // with this task open must be told, not left to save over the mover.
        ...(autoAssign ? { version: { increment: 1 } } : {}),
      },
      select: { id: true },
    });
    if (autoAssign) await tx.taskAssignee.createMany({ data: assignmentRows(task.id, [actor.id]) });

    const activity: Array<[ActivityType, Prisma.InputJsonObject]> = [];
    if (statusChanged) activity.push(["moved", { from, to }]);
    if (autoAssign) activity.push(["assigned", { userIds: [actor.id] }]);
    await log(tx, task.id, actor.id, activity);

    return changed(await readCard(tx, task.id));
  });
}

/** Hard delete; the checklist, comments, history and links go with it. */
export async function deleteTask(actor: Actor, id: string): Promise<ActionResult<{ id: string }>> {
  return boardWrite(actor, async (tx, actor) => {
    if (!canArchiveOrDelete(actor)) refuse("FORBIDDEN", "Only owners can delete tasks.");
    const task = await tx.task.findUnique({ where: { id }, select: { id: true } });
    if (!task) refuse("NOT_FOUND", MSG.taskGone);
    await tx.task.delete({ where: { id }, select: { id: true } });
    return changed({ id });
  });
}

export async function archiveTask(actor: Actor, id: string): Promise<ActionResult<{ id: string }>> {
  return boardWrite(actor, async (tx, actor) => {
    if (!canArchiveOrDelete(actor)) refuse("FORBIDDEN", "Only owners can archive tasks.");
    const task = await tx.task.findUnique({ where: { id }, select: { id: true, archivedAt: true } });
    if (!task) refuse("NOT_FOUND", MSG.taskGone);
    if (task.archivedAt) return unchanged({ id });
    await tx.task.update({
      where: { id },
      data: { archivedAt: new Date(), updatedById: actor.id },
      select: { id: true },
    });
    await log(tx, id, actor.id, [["archived"]]);
    return changed({ id });
  });
}

/**
  Back onto the board at the BOTTOM of the column it was archived from: its
  old position means nothing after the column has moved on without it.
*/
export async function restoreTask(actor: Actor, id: string): Promise<ActionResult<TaskCard>> {
  return boardWrite(actor, async (tx, actor) => {
    if (!canArchiveOrDelete(actor)) refuse("FORBIDDEN", "Only owners can restore tasks.");
    const task = await tx.task.findUnique({ where: { id }, select: { id: true, status: true, archivedAt: true } });
    if (!task) refuse("NOT_FOUND", MSG.taskGone);
    if (!task.archivedAt) return unchanged(await readCard(tx, id));
    const bottom = await tx.task.aggregate({
      where: { status: task.status, archivedAt: null },
      _max: { position: true },
    });
    await tx.task.update({
      where: { id },
      data: { archivedAt: null, position: positionBetween(bottom._max.position, null), updatedById: actor.id },
      select: { id: true },
    });
    await log(tx, id, actor.id, [["restored"]]);
    return changed(await readCard(tx, id));
  });
}

/** Archive every task in Done. */
export async function archiveDone(actor: Actor): Promise<ActionResult<{ count: number }>> {
  return boardWrite(actor, async (tx, actor) => {
    if (!canArchiveOrDelete(actor)) refuse("FORBIDDEN", "Only owners can archive tasks.");
    const done = await tx.task.findMany({ where: { status: "DONE", archivedAt: null }, select: { id: true } });
    if (done.length === 0) return unchanged({ count: 0 });
    const ids = done.map((t) => t.id);
    await tx.task.updateMany({ where: { id: { in: ids } }, data: { archivedAt: new Date(), updatedById: actor.id } });
    // Through log(), not a bare createMany, so the notifier sees these too
    // (it collapses a bulk archive into one summary push).
    for (const taskId of ids) await log(tx, taskId, actor.id, [["archived"]]);
    return changed({ count: ids.length });
  });
}

// ── People on a task ───────────────────────────────────────────────────────

/**
  "I'll take this." Already on it is a no-op, not an error. Assignees are
  part of what the task says, so this bumps the version — an owner's open
  edit of the assignee list must not silently undo it.
*/
export async function joinTask(actor: Actor, id: string): Promise<ActionResult<TaskCard>> {
  return boardWrite(actor, async (tx, actor) => {
    const task = await loadAccess(tx, id);
    assertLive(task);
    if (task.assigneeIds.includes(actor.id)) return unchanged(await readCard(tx, id));
    if (!canJoinTask(actor, task)) {
      refuse(
        "FORBIDDEN",
        task.status === "DONE"
          ? "This task is already done, so there is nothing to pick up."
          : "Someone is already on this task. Ask an owner to add you.",
      );
    }
    await tx.taskAssignee.createMany({ data: assignmentRows(id, [actor.id]) });
    await tx.task.update({
      where: { id },
      data: { version: { increment: 1 }, updatedById: actor.id },
      select: { id: true },
    });
    await log(tx, id, actor.id, [["assigned", { userIds: [actor.id] }]]);
    return changed(await readCard(tx, id));
  });
}

/** Step off a task. Not on it (any more) is a no-op, not an error. */
export async function leaveTask(actor: Actor, id: string): Promise<ActionResult<TaskCard>> {
  return boardWrite(actor, async (tx, actor) => {
    const task = await loadAccess(tx, id);
    assertLive(task);
    // On a live task the only thing canLeaveTask can object to is not being
    // on it, which is already the state asked for.
    if (!canLeaveTask(actor, task)) return unchanged(await readCard(tx, id));
    await tx.taskAssignee.delete({ where: { taskId_userId: { taskId: id, userId: actor.id } } });
    await tx.task.update({
      where: { id },
      data: { version: { increment: 1 }, updatedById: actor.id },
      select: { id: true },
    });
    await log(tx, id, actor.id, [["unassigned", { userIds: [actor.id] }]]);
    return changed(await readCard(tx, id));
  });
}

// ── Checklist ──────────────────────────────────────────────────────────────

/*
  Checklist changes do not bump the task's version — ticking an item must not
  invalidate an owner's open edit of the title — but they do bump the board
  revision, because the card shows the progress.
*/

function assertCanWorkChecklist(actor: Actor, task: TaskAccess): void {
  assertLive(task);
  if (!canWorkChecklist(actor, task)) refuse("FORBIDDEN", "You can only change the checklist on tasks you're on.");
}

/** Added at the end of the list. */
export async function addChecklistItem(
  actor: Actor,
  input: AddChecklistItemData,
): Promise<ActionResult<ChecklistItemDTO>> {
  return boardWrite(actor, async (tx, actor) => {
    const task = await loadAccess(tx, input.taskId);
    assertCanWorkChecklist(actor, task);
    const last = await tx.checklistItem.aggregate({ where: { taskId: task.id }, _max: { position: true } });
    const item = await tx.checklistItem.create({
      data: { taskId: task.id, text: input.text, position: positionBetween(last._max.position, null) },
      select: checklistItemSelect,
    });
    await touch(tx, task.id, actor.id);
    await log(tx, task.id, actor.id, [["checklist_added", { text: item.text }]]);
    return changed(toChecklistItem(item));
  });
}

/** Rename and/or tick. Only ticking is recorded in the history; a reworded item is not news. */
export async function updateChecklistItem(
  actor: Actor,
  input: UpdateChecklistItemData,
): Promise<ActionResult<ChecklistItemDTO>> {
  return boardWrite(actor, async (tx, actor) => {
    const item = await tx.checklistItem.findUnique({
      where: { id: input.id },
      select: { ...checklistItemSelect, taskId: true },
    });
    if (!item) refuse("NOT_FOUND", MSG.itemGone);
    const task = await loadAccess(tx, item.taskId);
    assertCanWorkChecklist(actor, task);

    const textChanged = input.text !== undefined && input.text !== item.text;
    const doneChanged = input.done !== undefined && input.done !== item.done;
    if (!textChanged && !doneChanged) return unchanged(toChecklistItem(item));

    const updated = await tx.checklistItem.update({
      where: { id: item.id },
      data: { ...(textChanged ? { text: input.text } : {}), ...(doneChanged ? { done: input.done } : {}) },
      select: checklistItemSelect,
    });
    await touch(tx, task.id, actor.id);
    if (doneChanged) {
      await log(tx, task.id, actor.id, [
        [updated.done ? "checklist_checked" : "checklist_unchecked", { text: updated.text }],
      ]);
    }
    return changed(toChecklistItem(updated));
  });
}

export async function deleteChecklistItem(actor: Actor, id: string): Promise<ActionResult<{ id: string }>> {
  return boardWrite(actor, async (tx, actor) => {
    const item = await tx.checklistItem.findUnique({ where: { id }, select: { id: true, taskId: true, text: true } });
    if (!item) refuse("NOT_FOUND", MSG.itemGone);
    const task = await loadAccess(tx, item.taskId);
    assertCanWorkChecklist(actor, task);
    await tx.checklistItem.delete({ where: { id }, select: { id: true } });
    await touch(tx, task.id, actor.id);
    await log(tx, task.id, actor.id, [["checklist_removed", { text: item.text }]]);
    return changed({ id });
  });
}

// ── Comments ───────────────────────────────────────────────────────────────

/*
  Anyone may comment on a live task. A comment is not a change to the task,
  so it neither bumps the version nor marks the task as updated by the
  commenter — but every comment write bumps the board revision, since the
  card shows the count and an open dialog shows the thread.
*/

export async function addComment(actor: Actor, input: AddCommentData): Promise<ActionResult<CommentDTO>> {
  return boardWrite(actor, async (tx, actor) => {
    const task = await loadAccess(tx, input.taskId);
    assertLive(task);
    if (!canComment(actor, task)) refuse("FORBIDDEN", "You can't comment on this task.");
    const comment = await tx.comment.create({
      data: { taskId: task.id, authorId: actor.id, body: input.body },
      select: commentSelect,
    });
    await log(tx, task.id, actor.id, [["commented"]]);
    return changed(toComment(comment));
  });
}

/** Only the author may edit a comment — owners included, so nobody's words are put in their mouth. */
export async function editComment(actor: Actor, input: EditCommentData): Promise<ActionResult<CommentDTO>> {
  return boardWrite(actor, async (tx, actor) => {
    const comment = await tx.comment.findUnique({
      where: { id: input.id },
      select: { ...commentSelect, taskId: true },
    });
    if (!comment) refuse("NOT_FOUND", MSG.commentGone);
    if (!canEditComment(actor, comment)) refuse("FORBIDDEN", "You can only edit your own comments.");
    assertLive(await loadAccess(tx, comment.taskId));
    if (comment.body === input.body) return unchanged(toComment(comment));
    const updated = await tx.comment.update({
      where: { id: comment.id },
      data: { body: input.body },
      select: commentSelect,
    });
    return changed(toComment(updated));
  });
}

/** Your own, or anyone's if you are an owner. */
export async function deleteComment(actor: Actor, id: string): Promise<ActionResult<{ id: string }>> {
  return boardWrite(actor, async (tx, actor) => {
    const comment = await tx.comment.findUnique({ where: { id }, select: { id: true, authorId: true, taskId: true } });
    if (!comment) refuse("NOT_FOUND", MSG.commentGone);
    if (!canDeleteComment(actor, comment)) refuse("FORBIDDEN", "You can only delete your own comments.");
    assertLive(await loadAccess(tx, comment.taskId));
    await tx.comment.delete({ where: { id }, select: { id: true } });
    return changed({ id });
  });
}
