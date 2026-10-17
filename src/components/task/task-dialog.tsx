"use client";
// CONTRACT STUB — props are fixed; implemented by the task-dialog builder.
import type { BoardData, TaskCard } from "@/modules/tasks/types";

export type TaskDialogProps = {
  /** The task to show; null means closed. */
  taskId: string | null;
  /** The board as the parent currently holds it — members and labels for the pickers, and the card for a first paint before the detail loads. */
  board: BoardData;
  currentUserId: string;
  onOpenChange: (open: boolean) => void;
  /** Any write that changed the card (fields, people, labels, checklist counts, comment count, status). */
  onTaskChanged: (card: TaskCard, revision: number) => void;
  /** The task was deleted or archived and should leave the board. */
  onTaskRemoved: (id: string, revision: number) => void;
  /** Labels were created/edited/deleted from inside the dialog; the parent should refetch the board. */
  onBoardStale: () => void;
};

export function TaskDialog(props: TaskDialogProps) {
  void props;
  return null;
}
