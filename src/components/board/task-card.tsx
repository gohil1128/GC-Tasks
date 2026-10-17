"use client";
import * as React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowUp, CalendarDays, Flame, ListChecks, MessageSquare } from "lucide-react";
import { AvatarStack, type AvatarPerson } from "@/components/ui/avatar";
import { tintClass } from "@/lib/colors";
import { dueState, shortDay, type DueState } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { TaskCard as TaskCardData } from "@/modules/tasks/types";
import { CardMenu } from "./card-menu";
import { isTempId, useBoard } from "./board-context";

const MAX_LABELS = 3;

const DUE_CLASS: Record<DueState, string> = {
  overdue: "bg-destructive-muted text-destructive",
  today: "bg-warning-muted text-warning",
  soon: "bg-brand-muted text-brand-ink",
  later: "text-muted-foreground",
};

const DUE_SR: Record<DueState, string> = {
  overdue: ", overdue",
  today: ", today",
  soon: ", soon",
  later: "",
};

/** Whether the card has anything to show under its title. */
function hasMetaRow(card: TaskCardData): boolean {
  return (
    card.priority === "HIGH" ||
    card.priority === "URGENT" ||
    card.dueDate !== null ||
    card.checklistTotal > 0 ||
    card.commentCount > 0 ||
    card.assigneeIds.length > 0 ||
    card.status === "IN_PROGRESS"
  );
}

type Ids = { title: string; labels: string; meta: string };

/**
  What a card shows, without any of the dragging — shared by the card in its
  column and the lifted copy that follows the pointer.
*/
function CardContent({ card, ids }: { card: TaskCardData; ids?: Ids }) {
  const { members, labels, today } = useBoard();
  const done = card.status === "DONE";

  const cardLabels = card.labelIds.flatMap((id) => labels.get(id) ?? []);
  const people: AvatarPerson[] = card.assigneeIds.flatMap((id) => members.get(id) ?? []);
  const unassignedInProgress = card.status === "IN_PROGRESS" && card.assigneeIds.length === 0;

  // Done work is not late; its date is shown, but calmly.
  const due = card.dueDate && today && !done ? dueState(card.dueDate, today) : null;
  const dueText = card.dueDate ? (due === "today" ? "Today" : shortDay(card.dueDate, today ?? card.dueDate)) : null;

  const urgent = card.priority === "URGENT";
  const high = card.priority === "HIGH";
  const checklistComplete = card.checklistTotal > 0 && card.checklistDone === card.checklistTotal;

  return (
    <>
      {cardLabels.length > 0 && (
        <ul id={ids?.labels} className="mb-1.5 flex flex-wrap gap-1 pr-7">
          {cardLabels.slice(0, MAX_LABELS).map((l) => (
            <li
              key={l.id}
              className={cn("max-w-[10rem] truncate rounded-full px-2 py-px text-2xs font-semibold", tintClass(l.color))}
            >
              {l.name}
            </li>
          ))}
          {cardLabels.length > MAX_LABELS && (
            <li className="rounded-full bg-beige-deep px-2 py-px text-2xs font-semibold text-muted-foreground">
              +{cardLabels.length - MAX_LABELS}
            </li>
          )}
        </ul>
      )}

      <p
        id={ids?.title}
        className={cn(
          "line-clamp-2 text-sm font-medium leading-snug [overflow-wrap:anywhere]",
          cardLabels.length === 0 && "pr-7",
          done && "text-muted-foreground",
        )}
      >
        {card.title}
      </p>

      {hasMetaRow(card) && (
        <div id={ids?.meta} className="mt-2 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-2xs">
          {(urgent || high) && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-semibold",
                done ? "text-muted-foreground" : urgent ? "text-destructive" : "text-brand-ink",
              )}
            >
              {urgent ? <Flame className="h-3 w-3" aria-hidden /> : <ArrowUp className="h-3 w-3" aria-hidden />}
              {urgent ? "Urgent" : "High"}
            </span>
          )}

          {dueText && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full py-0.5 font-medium",
                due && due !== "later" ? "px-1.5" : "",
                due ? DUE_CLASS[due] : "text-muted-foreground",
              )}
            >
              <CalendarDays className="h-3 w-3" aria-hidden />
              <span className="sr-only">Due </span>
              {dueText}
              {due && <span className="sr-only">{DUE_SR[due]}</span>}
            </span>
          )}

          {card.checklistTotal > 0 && (
            <span
              className={cn(
                "inline-flex items-center gap-1 tabular-nums",
                checklistComplete ? "font-semibold text-success" : "text-muted-foreground",
              )}
            >
              <ListChecks className="h-3.5 w-3.5" aria-hidden />
              <span aria-hidden>
                {card.checklistDone}/{card.checklistTotal}
              </span>
              <span className="sr-only">
                Checklist {card.checklistDone} of {card.checklistTotal} done
              </span>
            </span>
          )}

          {card.commentCount > 0 && (
            <span className="inline-flex items-center gap-1 tabular-nums text-muted-foreground">
              <MessageSquare className="h-3 w-3" aria-hidden />
              <span aria-hidden>{card.commentCount}</span>
              <span className="sr-only">
                {card.commentCount === 1 ? "1 comment" : `${card.commentCount} comments`}
              </span>
            </span>
          )}

          <span className="ml-auto flex shrink-0 items-center">
            {people.length > 0 ? (
              <>
                <span className="sr-only">On it: </span>
                <AvatarStack people={people} max={3} />
              </>
            ) : unassignedInProgress ? (
              <span className="italic text-muted-foreground">Unassigned</span>
            ) : null}
          </span>
        </div>
      )}
    </>
  );
}

const CARD_SURFACE =
  "block w-full rounded-xl border border-border/70 bg-card p-3 text-left text-card-foreground shadow-card";

/**
  One card in a column. The wrapper is what moves; the inner surface is what
  you grab, click or focus, and the "…" menu sits beside it rather than
  inside it so the menu never starts a drag and is never nested in another
  button.

  A card the viewer may not move (staff, on someone else's task) still takes
  part as a drop target — others can be dropped above or below it — but has
  no drag handle, no grab cursor, and no "sortable" semantics.
*/
export function SortableTaskCard({ card, draggable }: { card: TaskCardData; draggable: boolean }) {
  const { actions, labels } = useBoard();
  const pending = isTempId(card.id);
  const canDrag = draggable && !pending;
  const id = React.useId();
  const ids: Ids = { title: `${id}-title`, labels: `${id}-labels`, meta: `${id}-meta` };

  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: "card" },
    disabled: { draggable: !canDrag, droppable: false },
    attributes: { roleDescription: "draggable card" },
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  const describedBy = [
    card.labelIds.some((l) => labels.has(l)) ? ids.labels : null,
    hasMetaRow(card) ? ids.meta : null,
    canDrag ? attributes["aria-describedby"] : null,
  ]
    .filter(Boolean)
    .join(" ");

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (canDrag) listeners?.onKeyDown?.(event);
    // Enter while a keyboard drag is under way drops the card; it must not also open it.
    if (event.defaultPrevented || isDragging || pending) return;
    if (event.key === "Enter" || (!canDrag && event.key === " ")) {
      event.preventDefault();
      actions.open(card.id);
    }
  }

  return (
    <li ref={setNodeRef} style={style} className="group relative">
      <div
        ref={setActivatorNodeRef}
        {...(canDrag ? attributes : {})}
        {...(canDrag ? listeners : {})}
        role="button"
        tabIndex={pending ? -1 : 0}
        aria-labelledby={ids.title}
        aria-describedby={describedBy || undefined}
        aria-busy={pending || undefined}
        onClick={() => {
          if (!pending) actions.open(card.id);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          CARD_SURFACE,
          "select-none outline-none transition-[box-shadow,opacity,border-color] [-webkit-touch-callout:none]",
          "hover:border-border hover:shadow-lift",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-column",
          canDrag ? "cursor-grab touch-manipulation active:cursor-grabbing" : "cursor-pointer",
          card.status === "DONE" && "bg-card/70 shadow-none",
          pending && "cursor-progress opacity-60",
          // The card stays in its slot, faded, while its lifted copy follows the pointer.
          isDragging && "opacity-40 shadow-none",
        )}
      >
        <CardContent card={card} ids={ids} />
        {pending && <span className="sr-only">Saving…</span>}
      </div>
      {!pending && <CardMenu card={card} className="absolute right-1.5 top-1.5" />}
    </li>
  );
}

/** The lifted copy under the pointer while a card is dragged. */
export function DraggedCard({ card }: { card: TaskCardData }) {
  return (
    <div className={cn(CARD_SURFACE, "rotate-[1.5deg] cursor-grabbing shadow-float ring-1 ring-brand/30")}>
      <CardContent card={card} />
    </div>
  );
}
