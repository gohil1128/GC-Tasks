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

function push() {
  window.history.pushState({ ...window.history.state, gcSheet: true }, "");
  pushed = true;
}

function sync() {
  if (open.length > 0 && !pushed) {
    // Our own back() is still on its way; push once it has landed.
    if (!ownBack) push();
  } else if (open.length === 0 && pushed) {
    pushed = false;
    ownBack = true;
    window.history.back();
  }
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
