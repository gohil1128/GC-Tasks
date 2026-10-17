"use client";
import * as React from "react";
import type { TaskDetail } from "@/modules/tasks/types";
import { useLatest, useStateRef } from "./hooks";
import { mergeDetail } from "./task-logic";

export type DetailStatus = "loading" | "ready" | "error";

const RELOAD_DELAY_MS = 300;

/*
  The full task behind an open dialog, kept in step with the server.

  The board already polls and hands the dialog its copy of the card, so the
  dialog does not poll on its own: when that copy changes (a teammate's edit,
  a move, a comment) or the board refetches, the detail is read again.

  A read never lands on top of the dialog's own writes. While one is in
  flight — or if one started after the read did — the read is thrown away
  and made again once things are quiet, the same rule the board follows. So
  an optimistic checklist tick is never briefly undone by a read that set
  off before it was saved.
*/
export function useTaskDetail({
  taskId,
  reloadKey,
  onGone,
}: {
  taskId: string;
  /** Changes whenever the board's copy of the task (or the board) has moved on. */
  reloadKey: string;
  /** The task no longer exists. */
  onGone: () => void;
}) {
  const [detail, setDetail, detailRef] = useStateRef<TaskDetail | null>(null);
  const [status, setStatus] = React.useState<DetailStatus>("loading");
  const onGoneRef = useLatest(onGone);
  const state = React.useRef({
    active: true,
    inFlight: 0,
    /** Bumped whenever a write starts, so a read that began before it can tell. */
    epoch: 0,
    loading: false,
    wanted: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  });
  // load and flush call each other; a ref keeps both stable.
  const loadRef = React.useRef<() => void>(() => {});

  const flush = React.useCallback(() => {
    const s = state.current;
    if (!s.wanted || s.inFlight > 0 || s.loading) return;
    s.wanted = false;
    loadRef.current();
  }, []);

  const load = React.useCallback(async () => {
    const s = state.current;
    if (!s.active) return;
    if (s.loading || s.inFlight > 0) {
      s.wanted = true;
      return;
    }
    s.loading = true;
    const startedAt = s.epoch;
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!s.active) return;
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (res.status === 403) {
        // The read routes answer 403 only for a password that still has to be changed.
        window.location.href = "/change-password";
        return;
      }
      if (res.status === 404) {
        s.active = false;
        onGoneRef.current();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fresh = (await res.json()) as TaskDetail;
      if (!s.active) return;
      if (s.inFlight > 0 || s.epoch !== startedAt) {
        s.wanted = true;
        return;
      }
      setDetail((current) => mergeDetail(current, fresh));
      setStatus("ready");
    } catch {
      // A failed refresh of a task already on screen is not worth an alarm;
      // only a dialog with nothing loaded yet says so.
      if (s.active && !detailRef.current) setStatus("error");
    } finally {
      s.loading = false;
      flush();
    }
  }, [taskId, setDetail, detailRef, flush, onGoneRef]);

  React.useEffect(() => {
    loadRef.current = () => void load();
  }, [load]);

  React.useEffect(() => {
    const s = state.current;
    s.active = true;
    void load();
    return () => {
      s.active = false;
      clearTimeout(s.timer);
    };
  }, [load]);

  // Read again, shortly, when the board's copy moves on. Several changes in
  // quick succession (a drag, then its auto-assign) make one read.
  const lastKey = React.useRef(reloadKey);
  React.useEffect(() => {
    if (lastKey.current === reloadKey) return;
    lastKey.current = reloadKey;
    const s = state.current;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => loadRef.current(), RELOAD_DELAY_MS);
  }, [reloadKey]);

  /** Wrap every write in this, so a read holds off until it settles. */
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

  const reload = React.useCallback(() => {
    if (!detailRef.current) setStatus("loading");
    loadRef.current();
  }, [detailRef]);

  return { detail, detailRef, setDetail, status, track, reload };
}
