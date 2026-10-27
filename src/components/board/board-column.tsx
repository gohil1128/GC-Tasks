"use client";
import * as React from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canMoveTask } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, type Status, type TaskCard } from "@/modules/tasks/types";
import { useBoard } from "./board-context";
import { QuickAdd } from "./quick-add";
import { SortableTaskCard } from "./task-card";

const COLUMN_PREFIX = "column:";
const TAB_PREFIX = "tab:";

export function columnDroppableId(status: Status): string {
  return `${COLUMN_PREFIX}${status}`;
}

/** The phone layout's tab for a column — also a drop target (see ColumnTabs). */
export function tabDroppableId(status: Status): string {
  return `${TAB_PREFIX}${status}`;
}

/** The column a droppable id names (its tray or its phone tab), or null for a card's id. */
export function statusOfDroppable(id: string): Status | null {
  if (id.startsWith(COLUMN_PREFIX)) return id.slice(COLUMN_PREFIX.length) as Status;
  if (id.startsWith(TAB_PREFIX)) return id.slice(TAB_PREFIX.length) as Status;
  return null;
}

export function columnElementId(status: Status): string {
  return `board-column-${status}`;
}

/**
  One column: a recessed tray with its own scroll. The whole tray is a drop
  target, so a card can be dropped into an empty column or below the last
  card without having to aim at another card.

  On a phone the three columns sit side by side on a track that slides (see
  use-column-swipe.ts), each one a full screen wide, so the next column is
  already in place as a swipe brings it into view. The ones off screen are
  `offscreen`: inert, so they can't be tabbed into or read out. While a card
  is being held the track lies flat and only the selected column (`shown`) is
  displayed — the others are hidden rather than unmounted, so a drag keeps the
  same droppables everywhere, and re-measures them when it switches column.
*/
export function BoardColumn({
  status,
  cards,
  total,
  filtering,
  shown,
  offscreen,
  highlighted,
  dragging,
  canCreate,
  quickAddOpen,
  onQuickAddOpenChange,
  onAdd,
  quickAddRef,
  headerMenu,
}: {
  status: Status;
  /** The cards to show, in order — already filtered. */
  cards: TaskCard[];
  /** How many cards the column holds before filtering. */
  total: number;
  filtering: boolean;
  shown: boolean;
  /** Phone only: this column is waiting off screen on the track. */
  offscreen: boolean;
  /** A dragged card is currently previewed in this column. */
  highlighted: boolean;
  dragging: boolean;
  canCreate: boolean;
  quickAddOpen: boolean;
  onQuickAddOpenChange: (open: boolean) => void;
  onAdd: (title: string, status: Status) => Promise<boolean>;
  quickAddRef?: React.Ref<HTMLInputElement>;
  headerMenu?: React.ReactNode;
}) {
  const { actor } = useBoard();
  const { setNodeRef } = useDroppable({ id: columnDroppableId(status), data: { type: "column", status } });
  const label = STATUS_LABEL[status];
  const titleId = `${columnElementId(status)}-title`;
  const ids = React.useMemo(() => cards.map((c) => c.id), [cards]);
  // To do keeps its add box on screen; the other columns open one from "+".
  const persistentAdd = status === "TODO";
  const showAdd = canCreate && (persistentAdd || quickAddOpen);
  const countText = filtering && cards.length !== total ? `${cards.length} of ${total}` : String(total);

  return (
    <section
      ref={setNodeRef}
      id={columnElementId(status)}
      role="region"
      aria-label={label}
      inert={offscreen || undefined}
      className={cn(
        "flex min-h-0 w-full shrink-0 flex-col rounded-2xl bg-column ring-inset transition-shadow md:w-auto md:shrink",
        dragging && !shown && "hidden md:flex",
        highlighted && "ring-2 ring-brand/40",
      )}
    >
      <header className="flex shrink-0 items-center gap-2 py-2.5 pl-4 pr-2">
        <h2 id={titleId} className="display text-[0.95rem] font-semibold">
          {label}
        </h2>
        <span className="rounded-full bg-card px-2 py-px text-2xs font-semibold tabular-nums text-muted-foreground">
          <span aria-hidden>{countText}</span>
          <span className="sr-only">
            {filtering && cards.length !== total
              ? `${cards.length} of ${total} tasks shown`
              : total === 1
                ? "1 task"
                : `${total} tasks`}
          </span>
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {canCreate && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Add a task to ${label}`}
              title={`Add a task to ${label}`}
              onClick={() => onQuickAddOpenChange(true)}
            >
              <Plus className="h-4 w-4" aria-hidden />
            </Button>
          )}
          {headerMenu}
        </div>
      </header>

      {showAdd && (
        <QuickAdd
          key={persistentAdd ? "persistent" : "opened"}
          status={status}
          persistent={persistentAdd}
          autoFocus={!persistentAdd}
          inputRef={quickAddRef}
          onAdd={(title) => onAdd(title, status)}
          onClose={() => onQuickAddOpenChange(false)}
        />
      )}

      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        <SortableContext id={status} items={ids} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-2 p-0.5" aria-label={`${label} tasks`}>
            {cards.map((card) => (
              <SortableTaskCard key={card.id} card={card} draggable={canMoveTask(actor, card)} />
            ))}
          </ul>
        </SortableContext>

        {cards.length === 0 && (
          <div
            className={cn(
              "m-0.5 flex min-h-24 flex-col items-center justify-center rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground transition-colors",
              dragging ? "border-brand/50 bg-card/50" : "border-border",
            )}
          >
            {dragging ? (
              <p>Drop a card here</p>
            ) : total > 0 ? (
              <p>No cards here match the filters.</p>
            ) : (
              <p>Nothing here yet</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
