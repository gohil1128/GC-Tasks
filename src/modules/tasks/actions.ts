"use server";
// CONTRACT STUB — signatures are fixed; bodies are implemented by the server-core builder.
import type {
  ActionResult,
  ChecklistItemDTO,
  CommentDTO,
  CreateTaskInput,
  MoveTaskInput,
  TaskCard,
  UpdateTaskInput,
} from "@/modules/tasks/types";

/*
  Permissions (src/lib/permissions.ts), enforced here on the server:
    owners only: create, update, delete, archive, restore, archiveDone
    owners or staff ON the task: move, checklist add/update/delete
    join: owners, or staff on an unclaimed task that is not DONE
    leave: anyone on the task
    comments: anyone may add; edit own only; delete own, or any if owner
  A refusal is { ok:false, code:"FORBIDDEN" }.
*/

const TODO = (): never => {
  throw new Error("not implemented");
};

/** New tasks go to the TOP of their column. */
export async function createTaskAction(input: CreateTaskInput): Promise<ActionResult<TaskCard>> {
  void input;
  return TODO();
}

export async function updateTaskAction(input: UpdateTaskInput): Promise<ActionResult<TaskCard>> {
  void input;
  return TODO();
}

/**
  Moving an unassigned card into IN_PROGRESS assigns the mover. Entering DONE
  stamps completedAt; leaving DONE clears it.
*/
export async function moveTaskAction(input: MoveTaskInput): Promise<ActionResult<TaskCard>> {
  void input;
  return TODO();
}

export async function deleteTaskAction(id: string): Promise<ActionResult<{ id: string }>> {
  void id;
  return TODO();
}

export async function archiveTaskAction(id: string): Promise<ActionResult<{ id: string }>> {
  void id;
  return TODO();
}

/** Back onto the board, at the bottom of the column it was archived from. */
export async function restoreTaskAction(id: string): Promise<ActionResult<TaskCard>> {
  void id;
  return TODO();
}

/** Archive every non-archived task in DONE. Returns how many. */
export async function archiveDoneAction(): Promise<ActionResult<{ count: number }>> {
  return TODO();
}

/** "I'll take this" — add the signed-in person as an assignee. No version check: it only adds. */
export async function joinTaskAction(id: string): Promise<ActionResult<TaskCard>> {
  void id;
  return TODO();
}

/** Remove the signed-in person from the assignees. */
export async function leaveTaskAction(id: string): Promise<ActionResult<TaskCard>> {
  void id;
  return TODO();
}

export async function addChecklistItemAction(
  taskId: string,
  text: string,
): Promise<ActionResult<ChecklistItemDTO>> {
  void taskId;
  void text;
  return TODO();
}

export async function updateChecklistItemAction(
  id: string,
  patch: { text?: string; done?: boolean },
): Promise<ActionResult<ChecklistItemDTO>> {
  void id;
  void patch;
  return TODO();
}

export async function deleteChecklistItemAction(id: string): Promise<ActionResult<{ id: string }>> {
  void id;
  return TODO();
}

export async function addCommentAction(taskId: string, body: string): Promise<ActionResult<CommentDTO>> {
  void taskId;
  void body;
  return TODO();
}

/** Only the comment's author may edit it. */
export async function editCommentAction(id: string, body: string): Promise<ActionResult<CommentDTO>> {
  void id;
  void body;
  return TODO();
}

/** Only the comment's author may delete it. */
export async function deleteCommentAction(id: string): Promise<ActionResult<{ id: string }>> {
  void id;
  return TODO();
}
