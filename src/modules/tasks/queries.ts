// CONTRACT STUB — signatures are fixed; bodies are implemented by the server-core builder.
// Server-only reads. Callers are responsible for checking the session first.
import type { ArchivedTask, BoardData, TaskDetail } from "@/modules/tasks/types";

const TODO = (): never => {
  throw new Error("not implemented");
};

export async function getBoard(): Promise<BoardData> {
  return TODO();
}

export async function getRevision(): Promise<number> {
  return TODO();
}

/** null when the task does not exist. Archived tasks are returned too. */
export async function getTaskDetail(id: string): Promise<TaskDetail | null> {
  void id;
  return TODO();
}

/** Newest-archived first. */
export async function getArchivedTasks(): Promise<ArchivedTask[]> {
  return TODO();
}
