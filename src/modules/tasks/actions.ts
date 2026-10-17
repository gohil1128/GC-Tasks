"use server";
import * as tasks from "@/modules/tasks/service";
import { asActor, withInput } from "@/modules/tasks/session";
import type {
  ActionResult,
  ChecklistItemDTO,
  CommentDTO,
  CreateTaskInput,
  MoveTaskInput,
  TaskCard,
  UpdateTaskInput,
} from "@/modules/tasks/types";
import {
  addChecklistItemSchema,
  addCommentSchema,
  createTaskSchema,
  editCommentSchema,
  idSchema,
  moveTaskSchema,
  updateChecklistItemSchema,
  updateTaskSchema,
} from "@/modules/tasks/validation";

/*
  Permissions (src/lib/permissions.ts), enforced here on the server:
    owners only: create, update, delete, archive, restore, archiveDone
    owners or staff ON the task: move, checklist add/update/delete
    join: owners, or staff on an unclaimed task that is not DONE
    leave: anyone on the task
    comments: anyone may add; edit own only; delete own, or any if owner
  A refusal is { ok:false, code:"FORBIDDEN" }.

  Each action is the same three steps — who is asking, is the input sound,
  then the service in src/modules/tasks/service.ts, which re-reads the task
  inside its transaction and checks the rule above against that. Nothing
  here trusts what the browser believed the task looked like.
*/

/** New tasks go to the TOP of their column. */
export async function createTaskAction(input: CreateTaskInput): Promise<ActionResult<TaskCard>> {
  return asActor((actor) => withInput(createTaskSchema, input, (data) => tasks.createTask(actor, data)));
}

export async function updateTaskAction(input: UpdateTaskInput): Promise<ActionResult<TaskCard>> {
  return asActor((actor) => withInput(updateTaskSchema, input, (data) => tasks.updateTask(actor, data)));
}

/**
  Moving an unassigned card into IN_PROGRESS assigns the mover. Entering DONE
  stamps completedAt; leaving DONE clears it.
*/
export async function moveTaskAction(input: MoveTaskInput): Promise<ActionResult<TaskCard>> {
  return asActor((actor) => withInput(moveTaskSchema, input, (data) => tasks.moveTask(actor, data)));
}

export async function deleteTaskAction(id: string): Promise<ActionResult<{ id: string }>> {
  return asActor((actor) => withInput(idSchema, id, (taskId) => tasks.deleteTask(actor, taskId)));
}

export async function archiveTaskAction(id: string): Promise<ActionResult<{ id: string }>> {
  return asActor((actor) => withInput(idSchema, id, (taskId) => tasks.archiveTask(actor, taskId)));
}

/** Back onto the board, at the bottom of the column it was archived from. */
export async function restoreTaskAction(id: string): Promise<ActionResult<TaskCard>> {
  return asActor((actor) => withInput(idSchema, id, (taskId) => tasks.restoreTask(actor, taskId)));
}

/** Archive every non-archived task in DONE. Returns how many. */
export async function archiveDoneAction(): Promise<ActionResult<{ count: number }>> {
  return asActor((actor) => tasks.archiveDone(actor));
}

/** "I'll take this" — add the signed-in person as an assignee. No version check: it only adds. */
export async function joinTaskAction(id: string): Promise<ActionResult<TaskCard>> {
  return asActor((actor) => withInput(idSchema, id, (taskId) => tasks.joinTask(actor, taskId)));
}

/** Remove the signed-in person from the assignees. */
export async function leaveTaskAction(id: string): Promise<ActionResult<TaskCard>> {
  return asActor((actor) => withInput(idSchema, id, (taskId) => tasks.leaveTask(actor, taskId)));
}

export async function addChecklistItemAction(
  taskId: string,
  text: string,
): Promise<ActionResult<ChecklistItemDTO>> {
  return asActor((actor) =>
    withInput(addChecklistItemSchema, { taskId, text }, (data) => tasks.addChecklistItem(actor, data)),
  );
}

export async function updateChecklistItemAction(
  id: string,
  patch: { text?: string; done?: boolean },
): Promise<ActionResult<ChecklistItemDTO>> {
  // Picked field by field: `patch` comes off the wire and may not be an object at all.
  const raw = { id, text: patch?.text, done: patch?.done };
  return asActor((actor) =>
    withInput(updateChecklistItemSchema, raw, (data) => tasks.updateChecklistItem(actor, data)),
  );
}

export async function deleteChecklistItemAction(id: string): Promise<ActionResult<{ id: string }>> {
  return asActor((actor) => withInput(idSchema, id, (itemId) => tasks.deleteChecklistItem(actor, itemId)));
}

export async function addCommentAction(taskId: string, body: string): Promise<ActionResult<CommentDTO>> {
  return asActor((actor) => withInput(addCommentSchema, { taskId, body }, (data) => tasks.addComment(actor, data)));
}

/** Only the comment's author may edit it. */
export async function editCommentAction(id: string, body: string): Promise<ActionResult<CommentDTO>> {
  return asActor((actor) => withInput(editCommentSchema, { id, body }, (data) => tasks.editComment(actor, data)));
}

/**
  The comment's author may delete it, and so may any owner (they keep the
  board tidy) — see canDeleteComment in src/lib/permissions.ts.
*/
export async function deleteCommentAction(id: string): Promise<ActionResult<{ id: string }>> {
  return asActor((actor) => withInput(idSchema, id, (commentId) => tasks.deleteComment(actor, commentId)));
}
