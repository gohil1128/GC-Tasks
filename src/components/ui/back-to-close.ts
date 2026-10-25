import * as React from "react";

/*
  The phone's own Back closes the open sheet instead of leaving the app.

  The board is installed to home screens as a standalone app, so there is no
  browser back button: Android's Back key, or iOS Safari's edge swipe, is
  the only "back" people have. A sheet is not a page, so opening one adds
  nothing to the history — and Back skipped straight past it, out of the
  board.

  So while any sheet is open, one extra history entry sits on top. Back pops
  it and the topmost sheet closes. Closing a sheet any other way (a swipe,
  a button, Escape) takes the entry back off, so the next Back behaves as
  if no sheet had ever been open.

  One entry for all sheets, kept here rather than per sheet: going from one
  sheet straight to another (an archived task opening in the task sheet)
  must not pop and push in the same moment, because history.back() lands a
  tick later and would close the sheet that just opened.

  The entry copies the current history.state: the Next router keeps its own
  data there, and reloads the page on a popstate it does not recognise.
*/

type Entry = { close: () => void };

const open: Entry[] = [];
/** Our entry is on top of the history right now. */
let pushed = false;
/** We called history.back() ourselves; its popstate is not a user's Back. */
let ownBack = false;
let listening = false;
/** Navigations waiting for our entry to come off the history (afterSheetsClose). */
const waiting: Array<() => void> = [];

function push() {
  window.history.pushState({ ...window.history.state, gcSheet: true }, "");
  pushed = true;
}

function settled(): boolean {
  return open.length === 0 && !pushed && !ownBack;
}

function sync() {
  if (open.length > 0 && !pushed) {
    // Our own back() is still on its way; push once it has landed.
    if (!ownBack) push();
  } else if (open.length === 0 && pushed) {
    pushed = false;
    ownBack = true;
    window.history.back();
  } else if (settled() && waiting.length > 0) {
    // A task later, so the router has finished with the popstate first.
    const go = waiting.splice(0);
    setTimeout(() => go.forEach((run) => run()));
  }
}

/**
  Runs `go` — a router.push, say — once every sheet has closed and our entry
  is off the history. Navigating straight after closing a sheet does not
  stick: the history.back() that takes the entry off lands a tick later and
  undoes the push. Call it as the sheet is being closed.
*/
export function afterSheetsClose(go: () => void): void {
  if (settled()) go();
  else waiting.push(go);
}

function onPopState() {
  if (ownBack) {
    ownBack = false;
    sync();
    return;
  }
  if (!pushed) return;
  pushed = false;
  open[open.length - 1]?.close();
  // A sheet that refused to close (a save in flight), or one underneath,
  // still needs an entry for the next Back.
  queueMicrotask(sync);
}

export function useBackToClose(isOpen: boolean, close: () => void) {
  const closeRef = React.useRef(close);
  closeRef.current = close;

  React.useEffect(() => {
    if (!isOpen) return;
    if (!listening) {
      window.addEventListener("popstate", onPopState);
      listening = true;
    }
    const entry: Entry = { close: () => closeRef.current() };
    open.push(entry);
    queueMicrotask(sync);
    return () => {
      const at = open.indexOf(entry);
      if (at !== -1) open.splice(at, 1);
      // A microtask, so a sheet that closes as another opens nets out.
      queueMicrotask(sync);
    };
  }, [isOpen]);
}
