"use client";
import * as React from "react";

/** A ref that always holds the latest value, for handlers that must not change identity. */
export function useLatest<T>(value: T): React.MutableRefObject<T> {
  const ref = React.useRef(value);
  React.useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
  State that can also be read synchronously, straight after it is set. The
  dialog's writes chain several steps (apply optimistically, send, reconcile)
  and each needs to see what the previous one left, not the last render.
  Every update goes through the returned setter, so the two never disagree.
*/
export function useStateRef<T>(
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void, React.MutableRefObject<T>] {
  const [state, setState] = React.useState(initial);
  const ref = React.useRef(initial);
  const set = React.useCallback((next: T | ((prev: T) => T)) => {
    const value = typeof next === "function" ? (next as (prev: T) => T)(ref.current) : next;
    if (Object.is(value, ref.current)) return;
    ref.current = value;
    setState(value);
  }, []);
  return [state, set, ref];
}

/*
  One shared clock for "5m ago". It ticks every half minute while anything
  is listening, and is re-read whenever something starts listening, so a
  dialog opened hours after the page loaded does not start out stale.
*/
let clock = Date.now();

function subscribeToClock(onChange: () => void): () => void {
  clock = Date.now();
  const timer = setInterval(() => {
    clock = Date.now();
    onChange();
  }, 30_000);
  return () => clearInterval(timer);
}

/** Milliseconds since the epoch, refreshed every 30 seconds. */
export function useNow(): number {
  return React.useSyncExternalStore(
    subscribeToClock,
    () => clock,
    () => clock,
  );
}

/** A textarea that grows with what is typed instead of scrolling inside itself. */
export function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string): void {
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}

/** True for Cmd+Enter on a Mac and Ctrl+Enter elsewhere — "send" in a multi-line box. */
export function isSubmitShortcut(event: React.KeyboardEvent): boolean {
  return event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing;
}

/**
  Up and down arrows move between the options of a picker list, Home and End
  jump to the ends. Options are marked with data-picker-option.
*/
export function onPickerListKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-picker-option]"));
  if (options.length === 0) return;
  event.preventDefault();
  const at = options.indexOf(document.activeElement as HTMLElement);
  let next = 0;
  if (event.key === "End") next = options.length - 1;
  else if (event.key === "ArrowDown") next = at < 0 ? 0 : Math.min(options.length - 1, at + 1);
  else if (event.key === "ArrowUp") next = at < 0 ? options.length - 1 : Math.max(0, at - 1);
  options[next]?.focus();
}
