"use client";
import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { BoardMember } from "@/modules/tasks/types";
import { PICKER_TRIGGER_CLASS } from "./field";
import { onPickerListKeyDown } from "./hooks";
import { pickableMembers, toggleId } from "./task-logic";

/** Who is on a task, as avatars with names. */
export function PeopleList({
  people,
  currentUserId,
  empty = "Nobody yet",
}: {
  people: BoardMember[];
  currentUserId: string;
  empty?: string;
}) {
  if (people.length === 0) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
      {people.map((p) => (
        <span key={p.id} className="inline-flex min-w-0 items-center gap-1.5">
          <span aria-hidden>
            <Avatar person={p} size="sm" />
          </span>
          <span className={cn("truncate", !p.active && "text-muted-foreground line-through")}>
            {p.id === currentUserId ? `${p.name} (you)` : p.name}
          </span>
          {!p.active && <span className="sr-only">(deactivated)</span>}
        </span>
      ))}
    </span>
  );
}

/**
  The people on a task. Owners get a popover of the team to tick on and off
  (it stays open, so several can be picked in one go); everyone else sees the
  names. Only active accounts can be added — the server refuses anyone
  deactivated — but someone deactivated who is already on the task is listed
  so they can be taken off.
*/
export function AssigneePicker({
  labelId,
  members,
  value,
  onChange,
  readOnly,
  currentUserId,
}: {
  /** The field caption's id, so the trigger is announced as "Assignees, Riya and Sam". */
  labelId: string;
  members: BoardMember[];
  value: string[];
  onChange: (next: string[]) => void;
  readOnly?: boolean;
  currentUserId: string;
}) {
  const summaryId = React.useId();
  const byId = React.useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const chosen = value.flatMap((id) => byId.get(id) ?? []);

  if (readOnly) {
    return (
      <div role="group" aria-labelledby={labelId} className="flex min-h-10 items-center px-2 text-sm">
        <PeopleList people={chosen} currentUserId={currentUserId} />
      </div>
    );
  }

  const options = pickableMembers(members, value);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-labelledby={`${labelId} ${summaryId}`} className={PICKER_TRIGGER_CLASS}>
          <span id={summaryId} className="min-w-0 flex-1">
            <PeopleList people={chosen} currentUserId={currentUserId} />
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1.5" aria-label="Choose who is on this task">
        <p className="px-2.5 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Who is on this
        </p>
        {options.length === 0 ? (
          <p className="px-2.5 py-2 text-sm text-muted-foreground">There is nobody active on the team to add.</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto" onKeyDown={onPickerListKeyDown}>
            {options.map((m) => {
              const selected = value.includes(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    data-picker-option
                    aria-pressed={selected}
                    onClick={() => onChange(toggleId(value, m.id))}
                    className={cn(
                      "flex h-11 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-sm outline-none transition-colors",
                      "hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    <span aria-hidden>
                      <Avatar person={m} size="md" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {m.name}
                        {m.id === currentUserId && <span className="font-normal text-muted-foreground"> (you)</span>}
                      </span>
                      {!m.active && <span className="block text-2xs text-muted-foreground">Deactivated</span>}
                    </span>
                    <Check
                      aria-hidden
                      className={cn("h-4 w-4 shrink-0 text-brand-ink", selected ? "opacity-100" : "opacity-0")}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
