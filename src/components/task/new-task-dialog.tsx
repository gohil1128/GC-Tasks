"use client";
// CONTRACT STUB — props are fixed; implemented by the task-dialog builder.
import type { BoardData, Status, TaskCard } from "@/modules/tasks/types";

export type NewTaskDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: BoardData;
  currentUserId: string;
  /** Which column the task starts in. */
  defaultStatus: Status;
  onCreated: (card: TaskCard, revision: number) => void;
  onBoardStale: () => void;
};

export function NewTaskDialog(props: NewTaskDialogProps) {
  void props;
  return null;
}
