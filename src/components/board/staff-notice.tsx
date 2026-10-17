"use client";
import * as React from "react";
import { Info, X } from "lucide-react";

const KEY = "gc-tasks:staff-notice-dismissed";
const listeners = new Set<() => void>();
// Covers browsers where storage is blocked: dismissed stays dismissed until reload.
let dismissedHere = false;

function readDismissed(): boolean {
  if (dismissedHere) return true;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/*
  Staff meet a board where most cards cannot be dragged and most menus are
  short. One line says why, once; dismissing it is remembered in this
  browser only (it is a courtesy, not a setting worth storing).

  Shown only after hydration: the server cannot know it was dismissed, and
  flashing a notice someone already closed is worse than it arriving late.
*/
export function StaffNotice() {
  const dismissed = React.useSyncExternalStore(subscribe, readDismissed, () => true);
  if (dismissed) return null;

  function dismiss() {
    dismissedHere = true;
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      // Private mode or blocked storage: it just comes back next visit.
    }
    listeners.forEach((l) => l());
  }

  return (
    <div className="mx-4 mb-3 flex items-start gap-2 rounded-xl bg-brand-muted px-3 py-2 text-xs text-brand-ink sm:mx-6 sm:items-center">
      <Info className="mt-px h-4 w-4 shrink-0 sm:mt-0" aria-hidden />
      <p className="min-w-0 flex-1">
        You have staff access: you can move and update tasks you&apos;re on, pick up unclaimed tasks, and comment.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="-my-1 -mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
