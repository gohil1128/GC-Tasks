"use client";
import * as React from "react";
import { Lock, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBackToClose } from "@/components/ui/back-to-close";
import { useSwipeBack } from "@/components/ui/swipe-back";
import { Input } from "@/components/ui/input";
import { runAction } from "@/lib/action-client";
import type { ColorKey } from "@/lib/colors";
import { localToday } from "@/lib/dates";
import { canCreateTask, canManageLabels, type Actor } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { createLabelAction } from "@/modules/labels/actions";
import { createTaskAction } from "@/modules/tasks/actions";
import type { BoardData, LabelDTO, Status, TaskCard } from "@/modules/tasks/types";
import { AssigneePicker } from "./assignee-picker";
import { DueDateField } from "./due-date-field";
import { FieldLabel } from "./field";
import { isSubmitShortcut, useAutoGrow, useNow } from "./hooks";
import { LabelPicker } from "./label-picker";
import { PrioritySelect } from "./priority-select";
import { StatusSelect } from "./status-select";
import { actorFor, emptyNewTask, mergeLabels, toCreateInput, toggleId, type NewTaskForm } from "./task-logic";

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

/*
  Field captions here must not contain the word "title" except the title's
  own: the board's end-to-end test finds that field by a /title/i label, and
  a second match would make the lookup ambiguous.
*/

/**
  A task with everything set up front — for when the one-line quick add at
  the top of a column is not enough. Owners only; the board does not offer
  it to staff, and if it is opened for them anyway it says so instead of
  showing a form the server would refuse.
*/
export function NewTaskDialog({
  open,
  onOpenChange,
  board,
  currentUserId,
  defaultStatus,
  onCreated,
  onBoardStale,
}: NewTaskDialogProps) {
  const actor = actorFor(board.members, currentUserId);
  const [pending, setPending] = React.useState(false);
  const titleRef = React.useRef<HTMLInputElement>(null);
  const allowed = canCreateTask(actor);
  const pendingRef = React.useRef(pending);
  pendingRef.current = pending;
  const attachSwipe = useSwipeBack(
    () => {
      if (!pendingRef.current) onOpenChange(false);
    },
    () => !pendingRef.current,
  );
  useBackToClose(open, () => {
    if (!pendingRef.current) onOpenChange(false);
  });

  return (
    <Dialog
      open={open}
      // Closing is held off while the task is being saved, so a stray tap cannot hide a request still in flight.
      onOpenChange={(next) => !pending && onOpenChange(next)}
    >
      <DialogContent
        ref={attachSwipe}
        hideClose
        className="touch-pan-y sm:max-w-xl"
        onOpenAutoFocus={(event) => {
          if (!allowed) return;
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (event.target instanceof Element && event.target.closest("[data-escape-cancels]")) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription className={cn(allowed && "sr-only")}>
            {allowed ? "Everything but the name can be changed later." : "Only owners can add tasks."}
          </DialogDescription>
        </DialogHeader>
        {allowed ? (
          <NewTaskFormBody
            board={board}
            actor={actor}
            defaultStatus={defaultStatus}
            titleRef={titleRef}
            pending={pending}
            setPending={setPending}
            onCancel={() => onOpenChange(false)}
            onCreated={(card, revision) => {
              onCreated(card, revision);
              onOpenChange(false);
            }}
            onBoardStale={onBoardStale}
          />
        ) : (
          <div className="flex items-start gap-3 rounded-2xl bg-muted p-4 text-sm">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <p>Ask an owner to add it, or pick up an unclaimed task from the board.</p>
          </div>
        )}
        {!allowed && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
  The form itself. It mounts each time the dialog opens, so every new task
  starts from a clean form in the column it was asked for.
*/
function NewTaskFormBody({
  board,
  actor,
  defaultStatus,
  titleRef,
  pending,
  setPending,
  onCancel,
  onCreated,
  onBoardStale,
}: {
  board: BoardData;
  actor: Actor;
  defaultStatus: Status;
  titleRef: React.RefObject<HTMLInputElement | null>;
  pending: boolean;
  setPending: (pending: boolean) => void;
  onCancel: () => void;
  onCreated: (card: TaskCard, revision: number) => void;
  onBoardStale: () => void;
}) {
  const ids = {
    title: React.useId(),
    titleError: React.useId(),
    description: React.useId(),
    status: React.useId(),
    priority: React.useId(),
    due: React.useId(),
    dueError: React.useId(),
    assignees: React.useId(),
    labels: React.useId(),
  };
  const [form, setForm] = React.useState<NewTaskForm>(() => emptyNewTask(defaultStatus));
  const [problem, setProblem] = React.useState<{ field: "title" | "dueDate"; error: string } | null>(null);
  const [extraLabels, setExtraLabels] = React.useState<LabelDTO[]>([]);
  const descriptionRef = React.useRef<HTMLTextAreaElement>(null);
  const today = localToday(new Date(useNow()));
  useAutoGrow(descriptionRef, form.description);

  const labels = React.useMemo(() => mergeLabels(board.labels, extraLabels), [board.labels, extraLabels]);
  const me = board.members.find((m) => m.id === actor.id);
  const assignedToMe = form.assigneeIds.includes(actor.id);

  function update<K extends keyof NewTaskForm>(field: K, value: NewTaskForm[K]) {
    setForm((f) => ({ ...f, [field]: value }));
    if (problem?.field === field) setProblem(null);
  }

  async function createLabel(name: string, color: ColorKey): Promise<LabelDTO | null> {
    const result = await runAction(createLabelAction({ name, color }));
    if (!result.ok) return null;
    setExtraLabels((l) => [...l, result.data]);
    onBoardStale();
    return result.data;
  }

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (pending) return;
    const checked = toCreateInput(form);
    if (!checked.ok) {
      setProblem({ field: checked.field, error: checked.error });
      if (checked.field === "title") titleRef.current?.focus();
      return;
    }
    setPending(true);
    try {
      const result = await runAction(createTaskAction(checked.input));
      if (!result.ok) return;
      toast.success("Task added");
      onCreated(result.data, result.revision);
    } finally {
      setPending(false);
    }
  }

  const titleProblem = problem?.field === "title" ? problem.error : null;
  const dueProblem = problem?.field === "dueDate" ? problem.error : null;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <label htmlFor={ids.title} className="text-sm font-medium">
          Title
        </label>
        <Input
          id={ids.title}
          ref={titleRef}
          value={form.title}
          onChange={(e) => update("title", e.target.value)}
          maxLength={200}
          required
          autoComplete="off"
          enterKeyHint="done"
          placeholder="What needs doing?"
          aria-invalid={titleProblem ? true : undefined}
          aria-describedby={titleProblem ? ids.titleError : undefined}
          className="h-11 text-base sm:text-sm"
        />
        {titleProblem && (
          <p id={ids.titleError} className="text-xs text-destructive">
            {titleProblem}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor={ids.description} className="text-sm font-medium">
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id={ids.description}
          ref={descriptionRef}
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          onKeyDown={(e) => {
            if (isSubmitShortcut(e)) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={3}
          maxLength={10_000}
          placeholder="Anything worth knowing"
          className={cn(
            "block max-h-72 min-h-[5rem] w-full resize-none rounded-xl border border-input bg-card px-3 py-2 text-base leading-relaxed sm:text-sm",
            "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          )}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <FieldLabel htmlFor={ids.status}>Status</FieldLabel>
          <StatusSelect id={ids.status} value={form.status} onChange={(s) => update("status", s)} />
        </div>
        <div className="space-y-1">
          <FieldLabel htmlFor={ids.priority}>Priority</FieldLabel>
          <PrioritySelect id={ids.priority} value={form.priority} onChange={(p) => update("priority", p)} />
        </div>
        <div className="space-y-1">
          <FieldLabel htmlFor={ids.due}>Due date</FieldLabel>
          <DueDateField
            id={ids.due}
            value={form.dueDate || null}
            onChange={(d) => update("dueDate", d ?? "")}
            status={form.status}
            today={today}
            invalid={dueProblem !== null}
            describedBy={dueProblem ? ids.dueError : undefined}
          />
          {dueProblem && (
            <p id={ids.dueError} className="text-xs text-destructive">
              {dueProblem}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex min-h-7 items-center justify-between gap-2">
          <FieldLabel id={ids.assignees}>Assignees</FieldLabel>
          {me?.active && !assignedToMe && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-brand-ink"
              onClick={() => update("assigneeIds", toggleId(form.assigneeIds, actor.id))}
            >
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
              Assign to me
            </Button>
          )}
        </div>
        <AssigneePicker
          labelId={ids.assignees}
          members={board.members}
          value={form.assigneeIds}
          onChange={(next) => update("assigneeIds", next)}
          currentUserId={actor.id}
        />
      </div>

      <div className="space-y-1">
        <div className="flex min-h-7 items-center">
          <FieldLabel id={ids.labels}>Labels</FieldLabel>
        </div>
        <LabelPicker
          labelId={ids.labels}
          labels={labels}
          value={form.labelIds}
          onChange={(next) => update("labelIds", next)}
          onCreate={canManageLabels(actor) ? createLabel : undefined}
        />
      </div>

      <DialogFooter className="mt-1">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="brand" disabled={pending} aria-busy={pending || undefined}>
          {pending ? "Adding…" : "Add task"}
        </Button>
      </DialogFooter>
    </form>
  );
}
