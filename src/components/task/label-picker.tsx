"use client";
import * as React from "react";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COLOR_KEYS, solidClass, tintClass, type ColorKey } from "@/lib/colors";
import { cn } from "@/lib/utils";
import type { LabelDTO } from "@/modules/tasks/types";
import { PICKER_TRIGGER_CLASS } from "./field";
import { onPickerListKeyDown } from "./hooks";
import { filterLabels, labelNameProblem, toggleId } from "./task-logic";

export function LabelChip({ label, className }: { label: LabelDTO; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-[12rem] items-center truncate rounded-full px-2.5 py-0.5 text-xs font-semibold",
        tintClass(label.color),
        className,
      )}
    >
      {label.name}
    </span>
  );
}

function LabelChips({ labels }: { labels: LabelDTO[] }) {
  if (labels.length === 0) return <span className="text-muted-foreground">No labels</span>;
  return (
    <span className="flex min-w-0 flex-wrap gap-1.5">
      {labels.map((l) => (
        <LabelChip key={l.id} label={l} />
      ))}
    </span>
  );
}

function colorName(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** The palette as a radio group: arrow keys move between swatches and each is announced by name. */
function SwatchPicker({ name, value, onChange }: { name: string; value: ColorKey; onChange: (key: ColorKey) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Colour</legend>
      <div className="flex flex-wrap gap-1.5">
        {COLOR_KEYS.map((key) => (
          <label key={key} className="relative cursor-pointer" title={colorName(key)}>
            <input
              type="radio"
              name={name}
              value={key}
              checked={value === key}
              onChange={() => onChange(key)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full ring-offset-2 ring-offset-popover transition-shadow",
                "peer-checked:ring-2 peer-checked:ring-foreground/70",
                "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[4px] peer-focus-visible:outline-ring",
                solidClass(key),
              )}
            >
              {value === key && <Check className="h-3.5 w-3.5" />}
            </span>
            <span className="sr-only">{colorName(key)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
  The labels on a task. Owners tick them on and off in a popover, and can
  make a new one there without leaving the task; everyone else sees the
  chips. A label someone deleted while this was open simply stops showing —
  the server drops unknown ids too.
*/
export function LabelPicker({
  labelId,
  labels,
  value,
  onChange,
  readOnly,
  onCreate,
}: {
  /** The field caption's id. */
  labelId: string;
  labels: LabelDTO[];
  value: string[];
  onChange: (next: string[]) => void;
  readOnly?: boolean;
  /** Only for someone who may create labels. Resolves to the new label, or null if it was refused (and said why). */
  onCreate?: (name: string, color: ColorKey) => Promise<LabelDTO | null>;
}) {
  const summaryId = React.useId();
  const formId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [draft, setDraft] = React.useState<{ name: string; color: ColorKey } | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const nameRef = React.useRef<HTMLInputElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const byId = React.useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const chosen = value.flatMap((id) => byId.get(id) ?? []);

  if (readOnly) {
    return (
      <div role="group" aria-labelledby={labelId} className="flex min-h-10 items-center px-2 text-sm">
        <LabelChips labels={chosen} />
      </div>
    );
  }

  const shown = filterLabels(labels, query);
  const exact = labels.some((l) => l.name.toLocaleLowerCase() === query.trim().toLocaleLowerCase());

  function startCreating(name: string) {
    setDraft({ name: name.trim(), color: COLOR_KEYS[labels.length % COLOR_KEYS.length] });
    setProblem(null);
    // After the form renders.
    requestAnimationFrame(() => nameRef.current?.focus());
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    // React events bubble along the component tree, through the popover's
    // portal: without this the new-task form around the picker would submit too.
    event.stopPropagation();
    if (!draft || !onCreate || creating) return;
    const issue = labelNameProblem(labels, draft.name);
    if (issue) {
      setProblem(issue);
      nameRef.current?.focus();
      return;
    }
    setCreating(true);
    try {
      const label = await onCreate(draft.name.trim(), draft.color);
      if (!label) return;
      onChange(value.includes(label.id) ? value : [...value, label.id]);
      setDraft(null);
      setQuery("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setDraft(null);
          setQuery("");
          setProblem(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" aria-labelledby={`${labelId} ${summaryId}`} className={PICKER_TRIGGER_CLASS}>
          <span id={summaryId} className="min-w-0 flex-1">
            <LabelChips labels={chosen} />
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1.5" aria-label="Choose labels">
        {draft ? (
          <form id={formId} onSubmit={create} className="space-y-3 p-1.5">
            <div className="space-y-1.5">
              <label htmlFor={`${formId}-name`} className="text-xs font-medium text-muted-foreground">
                Label name
              </label>
              <Input
                id={`${formId}-name`}
                ref={nameRef}
                value={draft.name}
                maxLength={80}
                autoComplete="off"
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? `${formId}-problem` : undefined}
                onChange={(e) => {
                  setDraft({ ...draft, name: e.target.value });
                  setProblem(null);
                }}
                className="h-10"
              />
              {problem && (
                <p id={`${formId}-problem`} className="text-xs text-destructive">
                  {problem}
                </p>
              )}
            </div>
            <SwatchPicker name={`${formId}-color`} value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
            <div className="flex items-center justify-between gap-2 pt-1">
              <LabelChip label={{ id: "preview", name: draft.name.trim() || "Preview", color: draft.color }} />
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDraft(null);
                    requestAnimationFrame(() => searchRef.current?.focus());
                  }}
                  disabled={creating}
                >
                  Back
                </Button>
                <Button type="submit" size="sm" disabled={creating} aria-busy={creating || undefined}>
                  {creating ? "Saving…" : "Save label"}
                </Button>
              </div>
            </div>
          </form>
        ) : (
          <>
            <div className="relative mb-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  if (shown.length > 0) onChange(toggleId(value, shown[0].id));
                  else if (onCreate && query.trim()) startCreating(query);
                }}
                placeholder={onCreate ? "Find or make a label" : "Find a label"}
                aria-label="Search labels"
                autoComplete="off"
                className="h-10 pl-8"
              />
            </div>
            {shown.length > 0 ? (
              <ul className="max-h-64 overflow-y-auto" onKeyDown={onPickerListKeyDown}>
                {shown.map((l) => {
                  const selected = value.includes(l.id);
                  return (
                    <li key={l.id}>
                      <button
                        type="button"
                        data-picker-option
                        aria-pressed={selected}
                        onClick={() => onChange(toggleId(value, l.id))}
                        className={cn(
                          "flex h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-sm outline-none transition-colors",
                          "hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                      >
                        <span aria-hidden className={cn("h-3 w-3 shrink-0 rounded-full", solidClass(l.color))} />
                        <span className="min-w-0 flex-1 truncate">{l.name}</span>
                        <Check
                          aria-hidden
                          className={cn("h-4 w-4 shrink-0 text-brand-ink", selected ? "opacity-100" : "opacity-0")}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-2.5 py-2 text-sm text-muted-foreground">
                {labels.length === 0 ? "There are no labels yet." : "No label matches that."}
              </p>
            )}
            {onCreate && (
              <div className="mt-1 border-t border-border pt-1">
                <button
                  type="button"
                  onClick={() => startCreating(exact ? "" : query)}
                  className={cn(
                    "flex h-10 w-full items-center gap-2 rounded-xl px-2.5 text-left text-sm font-medium text-brand-ink outline-none transition-colors",
                    "hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  <span className="truncate">
                    {query.trim() && !exact ? `Create “${query.trim()}”` : "Create label"}
                  </span>
                </button>
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
