import * as React from "react";
import { STATUSES, type Status } from "@/modules/tasks/types";

/*
  Phone board: swipe left for the next column (To do → In progress → Done),
  right for the previous one. The tabs still work; this is the faster way.

  It has to stay out of the way of everything else a thumb does there:
    - scrolling a column: the gesture arms only once the movement is clearly
      sideways (well past 12px, and more across than down), and a movement
      that starts out vertical is a scroll for the rest of that touch;
    - dragging a card: the card drag is press-and-hold first, and a finger
      that moves this far this soon never becomes one; if a card drag IS
      running (`isDragging`), the swipe stands down;
    - the phone's own back gesture from the screen edge: touches that start
      within EDGE_PX of either side are left to the system;
    - typing: a touch that starts in a text field, or on anything marked
      data-no-swipe, is ignored.
  From md up all three columns are on screen and the gesture does not arm.

  While the finger is down the column follows it (with resistance past the
  first and last column), and on release it either commits — the next column
  slides in from the side the finger was heading — or springs back.
*/

export const COLUMN_SWIPE_MIN_X = 60;
export const COLUMN_FLICK_MIN_X = 24;
/** px per ms over the last stretch of the swipe. */
export const COLUMN_FLICK_VELOCITY = 0.4;
const ARM_PX = 12;
const EDGE_PX = 20;
const VELOCITY_WINDOW_MS = 100;
const EASING = "cubic-bezier(0.32, 0.72, 0.35, 1)";

/** The column a finished swipe lands on, or null to stay put. dx < 0 is a swipe to the left. */
export function columnAfterSwipe(current: Status, dx: number, velocityX: number): Status | null {
  const far = Math.abs(dx) >= COLUMN_SWIPE_MIN_X;
  const flick = Math.abs(dx) >= COLUMN_FLICK_MIN_X && Math.abs(velocityX) >= COLUMN_FLICK_VELOCITY;
  if (!far && !flick) return null;
  // A flick back the other way at the end cancels the swipe.
  if (velocityX !== 0 && Math.sign(velocityX) !== Math.sign(dx) && Math.abs(velocityX) >= COLUMN_FLICK_VELOCITY) {
    return null;
  }
  const at = STATUSES.indexOf(current);
  const next = dx < 0 ? at + 1 : at - 1;
  return STATUSES[next] ?? null;
}

function startsInsideNoSwipe(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest("input, textarea, select, [contenteditable=true], [data-no-swipe]");
}

export function useColumnSwipe({
  current,
  onChange,
  isDragging,
}: {
  current: Status;
  onChange: (status: Status) => void;
  isDragging: () => boolean;
}): (el: HTMLElement | null) => void {
  const latest = React.useRef({ current, onChange, isDragging });
  latest.current = { current, onChange, isDragging };
  const detach = React.useRef<(() => void) | null>(null);

  return React.useCallback((el: HTMLElement | null) => {
    detach.current?.();
    detach.current = null;
    if (!el) return;

    let start: { x: number; y: number } | null = null;
    let mode: "pending" | "swipe" | "other" = "pending";
    let lastDx = 0;
    let samples: { t: number; x: number }[] = [];

    const now = (event: TouchEvent) => (event.timeStamp > 0 ? event.timeStamp : Date.now());
    const velocity = (): number => {
      const last = samples[samples.length - 1];
      if (!last) return 0;
      const first = samples.find((s) => last.t - s.t <= VELOCITY_WINDOW_MS);
      if (!first || last.t <= first.t) return 0;
      return (last.x - first.x) / (last.t - first.t);
    };
    const shownColumn = () => el.querySelector<HTMLElement>(":scope > :not(.hidden)");
    const reset = (col: HTMLElement | null) => {
      if (!col) return;
      col.style.transition = "";
      col.style.transform = "";
      col.style.opacity = "";
    };

    const onTouchStart = (event: TouchEvent) => {
      start = null;
      if (event.touches.length !== 1 || window.matchMedia("(min-width: 768px)").matches) return;
      if (latest.current.isDragging() || startsInsideNoSwipe(event.target)) return;
      const touch = event.touches[0]!;
      if (touch.clientX < EDGE_PX || touch.clientX > window.innerWidth - EDGE_PX) return;
      start = { x: touch.clientX, y: touch.clientY };
      mode = "pending";
      lastDx = 0;
      samples = [{ t: now(event), x: touch.clientX }];
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!start) return;
      if (latest.current.isDragging()) {
        if (mode === "swipe") reset(shownColumn());
        start = null;
        return;
      }
      const touch = event.touches[0]!;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (mode === "pending") {
        if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
          mode = "other";
          return;
        }
        if (Math.abs(dx) < ARM_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        mode = "swipe";
      }
      if (mode !== "swipe") return;
      event.preventDefault();
      samples.push({ t: now(event), x: touch.clientX });
      if (samples.length > 20) samples = samples.slice(-20);
      const at = STATUSES.indexOf(latest.current.current);
      const pastEnd = (dx > 0 && at === 0) || (dx < 0 && at === STATUSES.length - 1);
      lastDx = dx;
      const col = shownColumn();
      if (col) {
        col.style.transition = "none";
        // Resistance where there is no column to go to, so it still feels alive.
        col.style.transform = `translateX(${pastEnd ? dx / 4 : dx}px)`;
      }
    };

    const onTouchEnd = () => {
      if (!start) return;
      const wasSwipe = mode === "swipe";
      const dx = lastDx;
      const vx = wasSwipe ? velocity() : 0;
      start = null;
      mode = "pending";
      if (!wasSwipe) return;
      const col = shownColumn();
      const target = latest.current.isDragging() ? null : columnAfterSwipe(latest.current.current, dx, vx);
      if (!target) {
        if (col) {
          col.style.transition = `transform 180ms ${EASING}`;
          col.style.transform = "translateX(0)";
          col.addEventListener("transitionend", () => reset(col), { once: true });
        }
        return;
      }
      reset(col);
      latest.current.onChange(target);
      // The new column slides in from the side the finger was heading.
      requestAnimationFrame(() => {
        const next = shownColumn();
        if (!next || typeof next.animate !== "function") return;
        const from = dx < 0 ? "36%" : "-36%";
        next.animate(
          [
            { transform: `translateX(${from})`, opacity: 0.4 },
            { transform: "translateX(0)", opacity: 1 },
          ],
          { duration: 220, easing: EASING },
        );
      });
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    // Not passive: once the gesture is a swipe, the column must not also scroll.
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    detach.current = () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);
}
