"use client";
import * as React from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, type Status } from "@/modules/tasks/types";

const TITLE_MAX = 200;

/**
  A one-line "add a task" box. Enter adds and keeps the box focused and empty,
  so a list can be typed in one go; Escape clears it and lets go. Everything
  else about the task is set later, from the card.

  `persistent` boxes (the one at the top of To do) stay on screen; the others
  appear from a column's "+" and go away on Escape or when left empty.
*/
export function QuickAdd({
  status,
  persistent = false,
  autoFocus = false,
  onAdd,
  onClose,
  inputRef,
}: {
  status: Status;
  persistent?: boolean;
  autoFocus?: boolean;
  /** Resolves false when the task was not added. */
  onAdd: (title: string) => Promise<boolean>;
  onClose?: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [title, setTitle] = React.useState("");
  const id = React.useId();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    const sent = clean.slice(0, TITLE_MAX);
    setTitle("");
    // Cleared at once for rapid entry, but a title the server never took (a
    // dropped connection, a refusal) comes back to be sent again — unless
    // something new has been typed since.
    void onAdd(sent).then((ok) => {
      if (!ok) setTitle((now) => (now === "" ? sent : now));
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setTitle("");
    if (persistent) event.currentTarget.blur();
    else onClose?.();
  }

  return (
    <form onSubmit={submit} className="px-2 pb-2">
      <label htmlFor={id} className="sr-only">
        New task in {STATUS_LABEL[status]}
      </label>
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border border-dashed border-border bg-card/60 px-3 transition-colors",
          "focus-within:border-solid focus-within:border-ring focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/30",
        )}
      >
        <Plus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          id={id}
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (!persistent && title.trim() === "") onClose?.();
          }}
          autoFocus={autoFocus}
          maxLength={TITLE_MAX}
          placeholder="Add a task…"
          enterKeyHint="done"
          autoComplete="off"
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {title.trim() !== "" && (
          <button
            type="submit"
            className="shrink-0 rounded-full bg-espresso px-2.5 py-1 text-2xs font-semibold text-espresso-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Add
          </button>
        )}
      </div>
    </form>
  );
}
