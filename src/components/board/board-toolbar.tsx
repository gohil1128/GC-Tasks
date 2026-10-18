"use client";
import * as React from "react";
import { ArrowUp, ChevronDown, CloudOff, Flame, Plus, RefreshCw, Search, Tag, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { tintClass } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { PRIORITIES, PRIORITY_LABEL, type LabelDTO, type BoardMember, type Priority } from "@/modules/tasks/types";
import { ME, NOBODY, hasFilters, type BoardFilters } from "./board-logic";

const chip =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const chipOff = "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground";
const chipOn = "border-espresso bg-espresso text-espresso-foreground";

/*
  Title, search and filters above the columns. Filters only change what is
  shown — never what is saved — and every one of them can be undone at once
  with "Clear filters".

  At 360px the search box takes the row and the label and priority filters
  shrink to icons; the people row scrolls sideways on its own rather than
  pushing the page wider.
*/
export function BoardToolbar({
  filters,
  onFiltersChange,
  members,
  labels,
  currentUserId,
  canCreate,
  onNewTask,
  searchRef,
  refreshing,
  offline,
  onRefresh,
}: {
  filters: BoardFilters;
  onFiltersChange: (next: BoardFilters) => void;
  /** Who can be picked in the people filter, already narrowed to those worth showing. */
  members: BoardMember[];
  labels: LabelDTO[];
  currentUserId: string;
  canCreate: boolean;
  onNewTask: () => void;
  searchRef: React.Ref<HTMLInputElement>;
  refreshing: boolean;
  offline: boolean;
  onRefresh: () => void;
}) {
  const set = (patch: Partial<BoardFilters>) => onFiltersChange({ ...filters, ...patch });

  return (
    <div className="flex shrink-0 flex-col gap-3 px-4 pb-3 pt-4 sm:px-6">
      <div className="flex items-center gap-2">
        <h1 className="display truncate text-2xl font-semibold leading-tight">Team board</h1>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRefresh}
          aria-label={offline ? "Can't reach the server. Retry now" : "Refresh the board"}
          title={offline ? "Can't reach the server — retrying. Click to retry now." : "Refresh the board"}
          className={cn("text-muted-foreground", offline && "text-warning")}
        >
          {offline ? (
            <CloudOff className="h-4 w-4" aria-hidden />
          ) : (
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden />
          )}
        </Button>
        {canCreate && (
          <Button
            type="button"
            variant="brand"
            onClick={onNewTask}
            className="ml-auto"
            aria-keyshortcuts="n"
            title="New task (N)"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New task
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <SearchBox
            value={filters.query}
            onChange={(query) => set({ query })}
            inputRef={searchRef}
          />
          <LabelFilter labels={labels} selected={filters.labelIds} onChange={(labelIds) => set({ labelIds })} />
          <PriorityFilter selected={filters.priorities} onChange={(priorities) => set({ priorities })} />
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <PeopleFilter
            members={members}
            currentUserId={currentUserId}
            selected={filters.people}
            onChange={(people) => set({ people })}
          />
          {hasFilters(filters) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground"
              onClick={() => onFiltersChange({ query: "", people: [], labelIds: [], priorities: [] })}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Clear filters
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  inputRef: React.Ref<HTMLInputElement>;
}) {
  return (
    <div className="relative min-w-0 flex-1 lg:w-72 lg:flex-none">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
        aria-label="Search tasks"
        aria-keyshortcuts="/"
        placeholder="Search tasks"
        autoComplete="off"
        className={cn(
          "h-9 w-full rounded-full border border-input bg-card pl-9 pr-9 text-sm transition-colors placeholder:text-muted-foreground",
          "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          "[&::-webkit-search-cancel-button]:hidden",
        )}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 text-2xs text-muted-foreground md:block">
          /
        </kbd>
      )}
    </div>
  );
}

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function FilterTrigger({
  icon,
  label,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        className={cn(chip, "px-2.5 sm:px-3", count > 0 ? chipOn : chipOff)}
        aria-label={count > 0 ? `${label}: ${count} selected` : label}
      >
        {icon}
        <span className="hidden sm:inline">{label}</span>
        {count > 0 && <span className="tabular-nums">{count}</span>}
        <ChevronDown className="hidden h-3.5 w-3.5 opacity-70 sm:block" aria-hidden />
      </button>
    </DropdownMenuTrigger>
  );
}

const checkItem = "rounded-xl py-2 pr-3 data-[highlighted]:bg-accent";

function LabelFilter({
  labels,
  selected,
  onChange,
}: {
  labels: LabelDTO[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  // A label deleted since it was picked no longer narrows anything; do not count it.
  const count = selected.filter((id) => labels.some((l) => l.id === id)).length;
  return (
    <DropdownMenu modal={false}>
      <FilterTrigger icon={<Tag className="h-3.5 w-3.5" aria-hidden />} label="Labels" count={count} />
      <DropdownMenuContent align="start" className="max-h-[min(24rem,60dvh)] w-60 overflow-y-auto">
        <DropdownMenuLabel>Show cards with any of</DropdownMenuLabel>
        {labels.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No labels yet.</p>}
        {labels.map((l) => (
          <DropdownMenuCheckboxItem
            key={l.id}
            checked={selected.includes(l.id)}
            // Stay open: picking several labels is the point.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onChange(toggle(selected, l.id))}
            className={checkItem}
          >
            <span className={cn("truncate rounded-full px-2 py-px text-xs font-semibold", tintClass(l.color))}>
              {l.name}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PriorityIcon({ priority }: { priority: Priority }) {
  if (priority === "URGENT") return <Flame className="h-3.5 w-3.5 text-destructive" aria-hidden />;
  if (priority === "HIGH") return <ArrowUp className="h-3.5 w-3.5 text-brand-ink" aria-hidden />;
  return <span className="h-3.5 w-3.5" aria-hidden />;
}

function PriorityFilter({ selected, onChange }: { selected: Priority[]; onChange: (p: Priority[]) => void }) {
  // Most urgent first: it is what people reach for.
  const order = [...PRIORITIES].reverse();
  return (
    <DropdownMenu modal={false}>
      <FilterTrigger icon={<Flame className="h-3.5 w-3.5" aria-hidden />} label="Priority" count={selected.length} />
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel>Show priority</DropdownMenuLabel>
        {order.map((p) => (
          <DropdownMenuCheckboxItem
            key={p}
            checked={selected.includes(p)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onChange(toggle(selected, p))}
            className={cn(checkItem, "gap-2")}
          >
            <PriorityIcon priority={p} />
            {PRIORITY_LABEL[p]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
  Everyone / My tasks / Unassigned, then one avatar per person. People
  combine — picking two avatars shows cards either of them is on.
*/
function PeopleFilter({
  members,
  currentUserId,
  selected,
  onChange,
}: {
  members: BoardMember[];
  currentUserId: string;
  selected: string[];
  onChange: (people: string[]) => void;
}) {
  const everyone = selected.length === 0;
  const mine = selected.length === 1 && selected[0] === ME;
  // The viewer's own avatar stands for "me", so it and "My tasks" agree.
  const tokenFor = (id: string) => (id === currentUserId ? ME : id);

  return (
    <div
      role="group"
      aria-label="Whose tasks"
      className="scroll-quiet -mx-4 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-4 py-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0"
    >
      <button
        type="button"
        aria-pressed={everyone}
        onClick={() => onChange([])}
        className={cn(chip, everyone ? chipOn : chipOff)}
      >
        Everyone
      </button>
      <button
        type="button"
        aria-pressed={mine}
        onClick={() => onChange(mine ? [] : [ME])}
        className={cn(chip, mine ? chipOn : chipOff)}
      >
        My tasks
      </button>
      <button
        type="button"
        aria-pressed={selected.includes(NOBODY)}
        onClick={() => onChange(toggle(selected, NOBODY))}
        className={cn(chip, selected.includes(NOBODY) ? chipOn : chipOff)}
      >
        Unassigned
      </button>
      {members.length > 0 && <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />}
      {members.map((m) => {
        const token = tokenFor(m.id);
        const on = selected.includes(token);
        return (
          <button
            key={m.id}
            type="button"
            aria-pressed={on}
            aria-label={m.id === currentUserId ? `${m.name} (you)` : m.name}
            title={m.name}
            onClick={() => onChange(toggle(selected, token))}
            className={cn(
              "shrink-0 rounded-full p-0.5 transition-[box-shadow,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              on ? "ring-2 ring-espresso" : everyone ? "" : "opacity-60 hover:opacity-100",
            )}
          >
            <Avatar person={m} size="md" className="ring-0" />
          </button>
        );
      })}
    </div>
  );
}
