"use client";
import * as React from "react";
import { Check, ListChecks, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChecklistItemDTO } from "@/modules/tasks/types";
import { isTempId } from "./task-logic";

const ITEM_MAX = 300;

function Progress({ done, total }: { done: number; total: number }) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const complete = total > 0 && done === total;
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label="Checklist progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${total} done`}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-beige-deep"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-300", complete ? "bg-success" : "bg-brand")}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className={cn("shrink-0 text-xs tabular-nums", complete ? "font-semibold text-success" : "text-muted-foreground")}>
        {done} of {total}
      </span>
    </div>
  );
}

function ItemRow({
  item,
  canWork,
  onToggle,
  onRename,
  onDelete,
}: {
  item: ChecklistItemDTO;
  canWork: boolean;
  onToggle: (id: string, done: boolean) => void;
  onRename: (id: string, text: string) => void;
  onDelete: (id: string) => void;
}) {
  const textId = React.useId();
  const [editing, setEditing] = React.useState<string | null>(null);
  // Read by blur right after Enter or Escape has already settled the edit.
  const editingRef = React.useRef<string | null>(null);
  const pending = isTempId(item.id);
  const live = canWork && !pending;

  function start() {
    editingRef.current = item.text;
    setEditing(item.text);
  }

  function finish(save: boolean) {
    const text = editingRef.current;
    editingRef.current = null;
    setEditing(null);
    if (!save || text === null) return;
    const clean = text.trim();
    if (clean && clean !== item.text) onRename(item.id, clean);
  }

  if (!canWork) {
    return (
      <li className="flex items-start gap-2.5 px-1.5 py-1.5 text-sm">
        <span
          className={cn(
            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
            item.done ? "border-success bg-success text-success-foreground" : "border-input",
          )}
        >
          {item.done && <Check className="h-3 w-3" aria-hidden />}
        </span>
        <span className={cn("min-w-0 flex-1 [overflow-wrap:anywhere]", item.done && "text-muted-foreground line-through")}>
          {item.text}
          <span className="sr-only">{item.done ? " (done)" : " (not done)"}</span>
        </span>
      </li>
    );
  }

  return (
    <li className="group flex items-start gap-1.5 rounded-xl px-0.5 transition-colors hover:bg-accent/40">
      <label className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          checked={item.done}
          disabled={!live}
          aria-labelledby={textId}
          onChange={(e) => onToggle(item.id, e.target.checked)}
          className="h-4 w-4 cursor-pointer rounded accent-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-progress"
        />
      </label>

      {editing !== null ? (
        <input
          autoFocus
          value={editing}
          maxLength={ITEM_MAX}
          aria-label="Edit checklist item"
          data-escape-cancels
          enterKeyHint="done"
          onChange={(e) => {
            editingRef.current = e.target.value;
            setEditing(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              finish(true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              finish(false);
            }
          }}
          onBlur={() => finish(true)}
          className="my-1 h-8 min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={!live}
          className={cn(
            "min-h-9 min-w-0 flex-1 rounded-lg px-1 py-2 text-left text-sm leading-snug outline-none [overflow-wrap:anywhere]",
            "focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-progress",
            item.done && "text-muted-foreground line-through",
          )}
        >
          <span id={textId}>{item.text}</span>
          <span className="sr-only">{pending ? " (saving)" : " (edit)"}</span>
        </button>
      )}

      {editing === null && (
        <button
          type="button"
          onClick={() => onDelete(item.id)}
          disabled={!live}
          aria-label={`Remove “${item.text}”`}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[opacity,background-color,color]",
            "hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            // Always there on touch screens, which cannot hover to reveal it.
            "[@media(hover:hover)]:opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 disabled:opacity-0",
          )}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </li>
  );
}

function AddItem({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = React.useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    const clean = text.trim();
    if (!clean) return;
    onAdd(clean);
    // The field keeps focus, so a list can be typed one line after another.
    setText("");
  }

  return (
    <form onSubmit={submit} className="mt-1 flex items-center gap-1.5 px-0.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
        <Plus className="h-4 w-4" />
      </span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text) {
            e.preventDefault();
            setText("");
          }
        }}
        data-escape-cancels={text ? true : undefined}
        maxLength={ITEM_MAX}
        placeholder="Add an item"
        aria-label="Add a checklist item"
        enterKeyHint="enter"
        autoComplete="off"
        className="h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-sm outline-none transition-colors placeholder:text-muted-foreground hover:border-border focus-visible:border-ring focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring/30"
      />
    </form>
  );
}

/**
  The task's checklist. Ticking, renaming, removing and adding all show at
  once and are put back if the server refuses; the dialog owns that, this
  only draws the list and reports what was done. Someone who may not work
  the task sees the list with its ticks and nothing to press.
*/
export function Checklist({
  items,
  canWork,
  loading,
  onAdd,
  onToggle,
  onRename,
  onDelete,
}: {
  items: ChecklistItemDTO[];
  canWork: boolean;
  loading?: boolean;
  onAdd: (text: string) => void;
  onToggle: (id: string, done: boolean) => void;
  onRename: (id: string, text: string) => void;
  onDelete: (id: string) => void;
}) {
  const headingId = React.useId();
  const done = items.filter((i) => i.done).length;

  if (!loading && !canWork && items.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
        <ListChecks className="h-4 w-4 text-muted-foreground" aria-hidden />
        Checklist
      </h3>
      {loading ? (
        <div className="space-y-2 py-1" aria-hidden>
          <div className="h-4 w-2/3 animate-pulse rounded bg-beige-deep" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-beige-deep" />
        </div>
      ) : (
        <>
          {items.length > 0 && <Progress done={done} total={items.length} />}
          {items.length > 0 && (
            <ul className="-mx-1">
              {items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  canWork={canWork}
                  onToggle={onToggle}
                  onRename={onRename}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          )}
          {canWork && (
            <div className="-mx-1">
              <AddItem onAdd={onAdd} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
