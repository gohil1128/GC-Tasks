"use client";
import { useDndContext, useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { STATUSES, STATUS_LABEL, type Status } from "@/modules/tasks/types";
import { columnElementId, tabDroppableId } from "./board-column";

/**
  The phone layout's column switcher: one column on screen at a time, picked
  here rather than swiped to, so a sideways thumb movement on a card is never
  mistaken for "next column". Hidden from md up, where all three columns fit.

  Each tab is also a drop target: press-and-hold a card, drag it onto another
  column's tab, and the board switches to that column so the card can be
  dropped exactly where it belongs (or dropped straight onto the tab to send
  it to the end of that column).
*/
export function ColumnTabs({
  active,
  counts,
  onChange,
}: {
  active: Status;
  counts: Record<Status, number>;
  onChange: (status: Status) => void;
}) {
  return (
    <div className="shrink-0 px-4 pb-3 md:hidden">
      <div role="group" aria-label="Column" className="grid grid-cols-3 gap-1 rounded-full bg-column p-1">
        {STATUSES.map((s) => (
          <ColumnTab key={s} status={s} selected={s === active} count={counts[s]} onChange={onChange} />
        ))}
      </div>
    </div>
  );
}

function ColumnTab({
  status,
  selected,
  count,
  onChange,
}: {
  status: Status;
  selected: boolean;
  count: number;
  onChange: (status: Status) => void;
}) {
  const { setNodeRef } = useDroppable({ id: tabDroppableId(status), data: { type: "tab", status } });
  const { active, over } = useDndContext();
  // Lit while a dragged card hovers this tab, so the finger knows it can drop.
  const hot = !!active && over?.id === tabDroppableId(status) && !selected;
  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-pressed={selected}
      aria-controls={columnElementId(status)}
      onClick={() => onChange(status)}
      className={cn(
        "flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-full px-2 text-xs font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
        hot && "bg-brand/20 text-foreground ring-2 ring-brand/60",
      )}
    >
      <span className="truncate">{STATUS_LABEL[status]}</span>
      <span
        className={cn(
          "rounded-full px-1.5 text-2xs tabular-nums",
          selected ? "bg-beige text-foreground" : "bg-card/60",
        )}
      >
        {count}
      </span>
    </button>
  );
}
