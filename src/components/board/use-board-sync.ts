"use client";
import * as React from "react";
import type { BoardData } from "@/modules/tasks/types";

/*
  Keeps an open board in step with everyone else's.

  Every few seconds, while the tab is visible, it asks for the board revision
  (one indexed read) and fetches the whole board only when the revision has
  moved past the one this board already reflects.

  A fetched board REPLACES local state, so it must never land on top of
  something local the server has not confirmed yet: while a card is being
  dragged, or while a write is in flight, a newer revision is noted and the
  check is made again once things are quiet. A board whose fetch began
  before a write started is thrown away for the same reason — it may predate
  that write.

  Network trouble is not worth a toast every four seconds: polling backs off
  quietly and the toolbar shows a small offline mark instead.
*/

const POLL_MS = 4_000;
const MAX_BACKOFF_MS = 60_000;

type Wanted = "none" | "check" | "fetch";

export type BoardSync = {
  /** Wrap every write in this, so polling holds off until it settles. */
  track: <T>(pending: Promise<T>) => Promise<T>;
  /** A drag is under way (true) or over (false). */
  setDragging: (dragging: boolean) => void;
  /** The revision one of this board's own writes came back with. */
  noteRevision: (revision: number) => void;
  /** Fetch the whole board now, or as soon as nothing is in flight. */
  refresh: () => void;
  refreshing: boolean;
  /** The last attempt to reach the server failed; polling is backing off. */
  offline: boolean;
};

/** Sends the browser where a read route's refusal points; true if it did. */
export function leaveFor(status: number): boolean {
  if (status === 401) {
    window.location.href = "/login";
    return true;
  }
  if (status === 403) {
    // The read routes answer 403 only for a password that still has to be changed.
    window.location.href = "/change-password";
    return true;
  }
  return false;
}

export function useBoardSync({
  initialRevision,
  onBoard,
}: {
  initialRevision: number;
  onBoard: (board: BoardData) => void;
}): BoardSync {
  const [refreshing, setRefreshing] = React.useState(false);
  const [offline, setOffline] = React.useState(false);

  const onBoardRef = React.useRef(onBoard);
  React.useEffect(() => {
    onBoardRef.current = onBoard;
  }, [onBoard]);

  const state = React.useRef({
    known: initialRevision,
    inFlight: 0,
    dragging: false,
    /** Bumped whenever local state starts to run ahead of the server. */
    epoch: 0,
    wanted: "none" as Wanted,
    checking: false,
    fetching: false,
    failures: 0,
    leaving: false,
  });

  const busy = React.useCallback(() => state.current.inFlight > 0 || state.current.dragging, []);

  const failed = React.useCallback(() => {
    state.current.failures += 1;
    setOffline(true);
  }, []);

  const succeeded = React.useCallback(() => {
    state.current.failures = 0;
    setOffline(false);
  }, []);

  // check, fetchBoard and flush call each other; refs keep them stable.
  const flushRef = React.useRef<() => void>(() => {});

  const want = React.useCallback((what: Exclude<Wanted, "none">) => {
    const s = state.current;
    if (what === "fetch" || s.wanted === "none") s.wanted = what;
  }, []);

  const fetchBoard = React.useCallback(async () => {
    const s = state.current;
    if (s.leaving) return;
    if (busy() || s.fetching) {
      want("fetch");
      return;
    }
    s.fetching = true;
    setRefreshing(true);
    const startedAt = s.epoch;
    try {
      const res = await fetch("/api/board", { cache: "no-store", headers: { accept: "application/json" } });
      if (leaveFor(res.status)) {
        s.leaving = true;
        return;
      }
      if (!res.ok) {
        failed();
        return;
      }
      const board = (await res.json()) as BoardData;
      succeeded();
      // Older than a write this browser has already seen land (a dialog's
      // save that committed while this read was on its way): applying it
      // would put the card back where it was and move `known` backwards.
      if (busy() || s.epoch !== startedAt || board.revision < s.known) {
        want("fetch");
        return;
      }
      s.known = board.revision;
      onBoardRef.current(board);
    } catch {
      failed();
    } finally {
      s.fetching = false;
      setRefreshing(false);
      flushRef.current();
    }
  }, [busy, failed, succeeded, want]);

  const check = React.useCallback(async () => {
    const s = state.current;
    if (s.leaving || s.checking || s.fetching) return;
    s.checking = true;
    try {
      const res = await fetch("/api/board/revision", {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (leaveFor(res.status)) {
        s.leaving = true;
        return;
      }
      if (!res.ok) {
        failed();
        return;
      }
      const { revision } = (await res.json()) as { revision: number };
      succeeded();
      if (revision > s.known) {
        // Our own write may be the reason; once it settles noteRevision() may
        // already account for it, so ask again then rather than fetch blind.
        if (busy()) want("check");
        else await fetchBoard();
      }
    } catch {
      failed();
    } finally {
      s.checking = false;
    }
  }, [busy, failed, fetchBoard, succeeded, want]);

  const flush = React.useCallback(() => {
    const s = state.current;
    if (s.wanted === "none" || busy() || s.fetching) return;
    const what = s.wanted;
    s.wanted = "none";
    void (what === "fetch" ? fetchBoard() : check());
  }, [busy, check, fetchBoard]);

  React.useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // The poll loop: a chain of timeouts so the gap can stretch after failures.
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const schedule = () => {
      clearTimeout(timer);
      if (stopped || document.visibilityState !== "visible") return;
      const delay = Math.min(POLL_MS * 2 ** state.current.failures, MAX_BACKOFF_MS);
      timer = setTimeout(() => {
        void check().finally(schedule);
      }, delay);
    };

    const wake = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      void check().finally(schedule);
    };

    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  }, [check]);

  const track = React.useCallback(
    <T,>(pending: Promise<T>): Promise<T> => {
      const s = state.current;
      s.inFlight += 1;
      s.epoch += 1;
      return pending.finally(() => {
        s.inFlight -= 1;
        flush();
      });
    },
    [flush],
  );

  const setDragging = React.useCallback(
    (dragging: boolean) => {
      const s = state.current;
      s.dragging = dragging;
      if (dragging) s.epoch += 1;
      else flush();
    },
    [flush],
  );

  /*
    Only a revision exactly one past the known one is taken as "just us".
    Anything further means somebody else wrote in between, and skipping to it
    would hide their change; leaving `known` alone lets the next poll fetch.
  */
  const noteRevision = React.useCallback((revision: number) => {
    const s = state.current;
    if (revision === s.known + 1) s.known = revision;
  }, []);

  const refresh = React.useCallback(() => {
    void fetchBoard();
  }, [fetchBoard]);

  return { track, setDragging, noteRevision, refresh, refreshing, offline };
}
