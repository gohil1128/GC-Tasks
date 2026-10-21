import * as React from "react";

/*
  Swipe right to go back, the phone pattern Harsh asked for on the task
  sheets in place of the ✕ button: a deliberate left-to-right swipe closes
  the sheet. Vertical scrolling must never trip it, so the gesture has to
  be long, mostly horizontal, and rightward.
*/

export const BACK_SWIPE_MIN_X = 80;
export const BACK_SWIPE_MAX_Y = 56;

export function isBackSwipe(dx: number, dy: number): boolean {
  return dx >= BACK_SWIPE_MIN_X && Math.abs(dy) <= BACK_SWIPE_MAX_Y && dx > Math.abs(dy) * 1.5;
}

/** Touch handlers for a sheet: spread onto the element that should close on a back swipe. */
export function useSwipeBack(onBack: () => void) {
  const start = React.useRef<{ x: number; y: number } | null>(null);
  const onBackRef = React.useRef(onBack);
  onBackRef.current = onBack;

  return {
    onTouchStart: (event: React.TouchEvent) => {
      const touch = event.touches[0];
      start.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    },
    onTouchEnd: (event: React.TouchEvent) => {
      const from = start.current;
      start.current = null;
      const touch = event.changedTouches[0];
      if (!from || !touch) return;
      if (isBackSwipe(touch.clientX - from.x, touch.clientY - from.y)) onBackRef.current();
    },
  };
}
