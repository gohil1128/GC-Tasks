"use client";
import { cn } from "@/lib/utils";
import { STATUSES, STATUS_LABEL, type Status } from "@/modules/tasks/types";
import { columnElementId } from "./board-column";

/**
  The phone layout's column switcher: one column on screen at a time, picked
  here rather than swiped to, so a sideways thumb movement on a card is never
  mistaken for "next column". Hidden from md up, where all three columns fit.
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
        {STATUSES.map((s) => {
          const on = s === active;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              aria-controls={columnElementId(s)}
              onClick={() => onChange(s)}
              className={cn(
                "flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-full px-2 text-xs font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="truncate">{STATUS_LABEL[s]}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 text-2xs tabular-nums",
                  on ? "bg-beige text-foreground" : "bg-card/60",
                )}
              >
                {counts[s]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
