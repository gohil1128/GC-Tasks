"use client";
import * as React from "react";
import { ArchiveRestore, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import { AvatarStack, type AvatarPerson } from "@/components/ui/avatar";
import { useBackToClose } from "@/components/ui/back-to-close";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSwipeBack } from "@/components/ui/swipe-back";
import { runAction } from "@/lib/action-client";
import { tintClass } from "@/lib/colors";
import { timeAgo } from "@/lib/dates";
import { canArchiveOrDelete } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { deleteTaskAction, restoreTaskAction } from "@/modules/tasks/actions";
import { STATUS_LABEL, type ArchivedTask, type TaskCard } from "@/modules/tasks/types";
import { useBoard } from "./board-context";
import { leaveFor } from "./use-board-sync";

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; tasks: ArchivedTask[] };

/*
  Archived tasks, newest first. Owners can put one back on the board (it
  goes to the bottom of the column it was archived from) or delete it for
  good. Staff may look but not touch: archiving is an owner's call, and the
  list answers "where did that card go?" for everyone.

  Read fresh each time it opens rather than kept in step with the board:
  it is a back room people visit, not something they watch.
*/
export function ArchivedPanel({
  open,
  onOpenChange,
  onRestored,
  onDeleted,
  onOpenTask,
  track,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: (card: TaskCard, revision: number) => void;
  onDeleted: (id: string, revision: number) => void;
  onOpenTask: (id: string) => void;
  track: <T>(pending: Promise<T>) => Promise<T>;
}) {
  const { actor, members, labels } = useBoard();
  const [load, setLoad] = React.useState<Load>({ state: "loading" });
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<ArchivedTask | null>(null);
  const canManage = canArchiveOrDelete(actor);

  const fetchArchived = React.useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const res = await fetch("/api/board/archived", { cache: "no-store", headers: { accept: "application/json" } });
      if (leaveFor(res.status)) return;
      if (!res.ok) throw new Error(String(res.status));
      setLoad({ state: "ready", tasks: (await res.json()) as ArchivedTask[] });
    } catch {
      setLoad({ state: "error" });
    }
  }, []);

  React.useEffect(() => {
    if (open) void fetchArchived();
  }, [open, fetchArchived]);

  function drop(id: string) {
    setLoad((l) => (l.state === "ready" ? { state: "ready", tasks: l.tasks.filter((t) => t.id !== id) } : l));
  }

  async function restore(task: ArchivedTask) {
    setBusyId(task.id);
    const result = await track(runAction(restoreTaskAction(task.id)));
    setBusyId(null);
    if (!result.ok) {
      // Deleted by another owner while this list was open: nothing left to
      // restore, so take the row away rather than let every retry fail.
      if (result.code === "NOT_FOUND") drop(task.id);
      return;
    }
    drop(task.id);
    onRestored(result.data, result.revision);
    toast.success(`Restored to ${STATUS_LABEL[result.data.status]}.`);
  }

  async function confirmDelete(): Promise<boolean> {
    if (!deleting) return true;
    const task = deleting;
    const result = await track(runAction(deleteTaskAction(task.id)));
    if (!result.ok) {
      // Already gone — another owner got there first — is what was wanted;
      // runAction has said so.
      if (result.code === "NOT_FOUND") {
        drop(task.id);
        return true;
      }
      return false;
    }
    drop(task.id);
    onDeleted(task.id, result.revision);
    toast.success("Task deleted.");
    return true;
  }

  const attachSwipe = useSwipeBack(() => onOpenChange(false));
  useBackToClose(open, () => onOpenChange(false));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent ref={attachSwipe} hideClose className="touch-pan-y sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Archived tasks</DialogTitle>
            <DialogDescription>
              {canManage
                ? "Off the board but kept, with their history. Restore one to put it back at the bottom of its column."
                : "Off the board but kept, with their history. Only owners can restore or delete them."}
            </DialogDescription>
          </DialogHeader>

          {load.state === "loading" && (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading archived tasks…
            </div>
          )}

          {load.state === "error" && (
            <div className="flex flex-col items-start gap-3 py-6 text-sm" role="alert">
              <p>Couldn&apos;t load the archive. Check your connection and try again.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void fetchArchived()}>
                Try again
              </Button>
            </div>
          )}

          {load.state === "ready" && load.tasks.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing has been archived yet.</p>
          )}

          {load.state === "ready" && load.tasks.length > 0 && (
            <ul className="-mx-2 flex flex-col divide-y divide-border">
              {load.tasks.map((task) => {
                const people: AvatarPerson[] = task.assigneeIds.flatMap((id) => members.get(id) ?? []);
                const taskLabels = task.labelIds.flatMap((id) => labels.get(id) ?? []);
                const busy = busyId === task.id;
                return (
                  <li key={task.id} className="flex flex-col gap-2 px-2 py-3 sm:flex-row sm:items-center sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => onOpenTask(task.id)}
                        className="line-clamp-2 rounded-md text-left text-sm font-medium [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {task.title}
                      </button>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
                        <span>
                          From {STATUS_LABEL[task.status]}
                          {task.archivedAt ? ` · archived ${timeAgo(task.archivedAt)}` : ""}
                        </span>
                        {taskLabels.map((l) => (
                          <span
                            key={l.id}
                            className={cn("rounded-full px-1.5 py-px font-semibold", tintClass(l.color))}
                          >
                            {l.name}
                          </span>
                        ))}
                        {people.length > 0 && <AvatarStack people={people} size="xs" />}
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          aria-busy={busy}
                          onClick={() => void restore(task)}
                          aria-label={`Restore ${task.title}`}
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
                          )}
                          Restore
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          className="text-destructive hover:bg-destructive-muted hover:text-destructive"
                          onClick={() => setDeleting(task)}
                          aria-label={`Delete ${task.title} permanently`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          Delete
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title="Delete this task for good?"
        description={
          <>
            <p>
              &ldquo;{deleting?.title}&rdquo; will be deleted along with its checklist, comments and history.
            </p>
            <p>This can&apos;t be undone.</p>
          </>
        }
        confirmLabel="Delete permanently"
        pendingLabel="Deleting…"
        destructive
        onConfirm={confirmDelete}
      />
    </>
  );
}
