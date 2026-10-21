import * as React from "react";

/*
  Swipe right to go back, phone-style: the sheet follows the finger in
  real time (the ask was "as smooth as possible, like iOS"), then either
  slides the rest of the way off or springs back if the swipe was short.
  Vertical scrolling must never trip it, so the gesture only takes over
  once the movement is clearly horizontal and rightward; from then on the
  sheet tracks the finger 1:1 until release.

  Phone sheets only: from `sm` up the dialog is a centred card whose
  position comes from a CSS translate, which an inline drag transform
  would fight — the gesture simply does not arm there.
*/

export const BACK_SWIPE_MIN_X = 80;
export const BACK_SWIPE_MAX_Y = 56;

export function isBackSwipe(dx: number, dy: number): boolean {
  return dx >= BACK_SWIPE_MIN_X && Math.abs(dy) <= BACK_SWIPE_MAX_Y && dx > Math.abs(dy) * 1.5;
}

const SLIDE_EASING = "cubic-bezier(0.32, 0.72, 0.35, 1)";

export function useSwipeBack(ref: React.RefObject<HTMLElement | null>, onBack: () => void) {
  const onBackRef = React.useRef(onBack);
  onBackRef.current = onBack;

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let start: { x: number; y: number } | null = null;
    let mode: "pending" | "drag" | "scroll" = "pending";
    let lastDx = 0;
    let lastDy = 0;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || window.matchMedia("(min-width: 640px)").matches) {
        start = null;
        return;
      }
      const touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY };
      mode = "pending";
      lastDx = 0;
      lastDy = 0;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.touches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (mode === "pending") {
        if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
          mode = "scroll";
          return;
        }
        if (dx > 8 && dx > Math.abs(dy)) {
          mode = "drag";
          el.style.transition = "none";
        } else {
          return;
        }
      }
      if (mode !== "drag") return;
      event.preventDefault();
      lastDx = Math.max(0, dx);
      lastDy = dy;
      el.style.transform = `translateX(${lastDx}px)`;
    };

    const onTouchEnd = () => {
      if (!start) return;
      const wasDrag = mode === "drag";
      const dx = lastDx;
      const dy = lastDy;
      start = null;
      mode = "pending";
      if (!wasDrag) return;

      if (isBackSwipe(dx, dy)) {
        // Complete the slide the finger started, then hand over to the
        // dialog's own close once the sheet is (nearly) off screen.
        el.style.transition = `transform 200ms ${SLIDE_EASING}`;
        el.style.transform = `translateX(${el.clientWidth + 48}px)`;
        window.setTimeout(() => onBackRef.current(), 190);
      } else {
        el.style.transition = `transform 240ms ${SLIDE_EASING}`;
        el.style.transform = "translateX(0px)";
        const clear = () => {
          el.style.transition = "";
          el.style.transform = "";
          el.removeEventListener("transitionend", clear);
        };
        el.addEventListener("transitionend", clear);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [ref]);
}
