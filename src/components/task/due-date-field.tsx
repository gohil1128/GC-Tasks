"use client";
import * as React from "react";
import { AlertCircle, CalendarDays, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { shortDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { Status } from "@/modules/tasks/types";
import { dueBadge, isPlausibleDay } from "./task-logic";

const BADGE_CLASS = {
  overdue: "bg-destructive-muted text-destructive",
  today: "bg-warning-muted text-warning",
  soon: "bg-brand-muted text-brand-ink",
} as const;

function DueBadge({ dueDate, status, today }: { dueDate: string | null; status: Status; today: string }) {
  const badge = dueBadge(dueDate, status, today);
  if (!badge) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold",
        BADGE_CLASS[badge.state],
      )}
    >
      {badge.state === "overdue" && <AlertCircle className="h-3 w-3" aria-hidden />}
      {badge.text}
    </span>
  );
}

/**
  A calendar day, or none. The browser's own date field, so phones get their
  native picker.

  A date field reports every keystroke in the year as a complete day (0002,
  0020, 0202…), so while the person types only a plausible day is passed on;
  whatever is left half-typed when they leave the field snaps back to the
  saved value rather than being saved.
*/
export function DueDateField({
  id,
  value,
  onChange,
  readOnly,
  status,
  today,
  invalid,
  describedBy,
}: {
  id: string;
  value: string | null;
  onChange: (day: string | null) => void;
  readOnly?: boolean;
  status: Status;
  today: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [text, setText] = React.useState(value ?? "");
  const [focused, setFocused] = React.useState(false);
  const [prevValue, setPrevValue] = React.useState(value);

  // Follow the saved value (a teammate's change, a rollback) unless the person is typing in the field.
  if (value !== prevValue) {
    setPrevValue(value);
    if (!focused) setText(value ?? "");
  }

  if (readOnly) {
    return (
      <p id={id} className="flex min-h-10 flex-wrap items-center gap-2 px-2 text-sm">
        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        {value ? shortDay(value, today) : <span className="text-muted-foreground">No due date</span>}
        <DueBadge dueDate={value} status={status} today={today} />
      </p>
    );
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    setText(next);
    if (next === "") {
      // Empty with bad input is a day still being typed, not a cleared field.
      if (!event.target.validity.badInput && value !== null) onChange(null);
      return;
    }
    if (isPlausibleDay(next) && next !== value) onChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        id={id}
        type="date"
        value={text}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setText(value ?? "");
        }}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="h-10 w-auto min-w-[10.5rem] flex-1 sm:flex-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setText("");
            onChange(null);
          }}
          aria-label="Clear due date"
          className="inline-flex h-10 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Clear
        </button>
      )}
      <DueBadge dueDate={value} status={status} today={today} />
    </div>
  );
}
