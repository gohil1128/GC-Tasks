import * as React from "react";

/*
  Swipe right to go back, phone-style: the sheet follows the finger in
  real time, then either slides the rest of the way off or springs back
  if the swipe was short. Vertical scrolling must never trip it, so the
  gesture only takes over once the movement is clearly horizontal and
  rightward; from then on the sheet tracks the finger 1:1 until release.

  Phone sheets only: from `sm` up the dialog is a centred card whose
  position comes from a CSS translate, which an inline drag transform
  would fight — the gesture simply does not arm there.

  Wiring lesson (the Oct 22 bug): the listeners must attach when the
  sheet MOUNTS, not when the page loads — a dialog's content does not
  exist until it opens, so an effect keyed on a ref object ran once with
  a null element and the swipe was dead. Hence the callback-ref shape
  below: React calls it with the element exactly when it appears.
*/

/*
  When a release closes the sheet. Once the gesture has taken over it is a
  horizontal drag, so how far the thumb drifted up or down on the way no
  longer matters (an earlier rule did check it, and turned most real thumb
  swipes, which arc, into a spring-back). Either the sheet has been dragged
  far enough, or it was flicked: a quick swipe goes back, as on iOS,
  however short. A flick back to the left cancels even a long drag.
*/
export const BACK_SWIPE_MIN_X = 80;
export const BACK_FLICK_MIN_X = 24;
/** px per ms, measured over the last stretch of the swipe. */
export const BACK_FLICK_VELOCITY = 0.35;

export function isBackSwipe(dx: number, velocityX: number): boolean {
  if (velocityX <= -BACK_FLICK_VELOCITY) return false;
  return dx >= BACK_SWIPE_MIN_X || (dx >= BACK_FLICK_MIN_X && velocityX >= BACK_FLICK_VELOCITY);
}

/** How long the sheet takes to slide the rest of the way: quicker after a quicker flick. */
export function slideOffMs(remainingPx: number, velocityX: number): number {
  const ms = remainingPx / Math.max(velocityX, 1.6);
  return Math.round(Math.min(200, Math.max(120, ms)));
}

/** Swipe speed over roughly the last 100ms of samples. */
const VELOCITY_WINDOW_MS = 100;

const SLIDE_EASING = "cubic-bezier(0.32, 0.72, 0.35, 1)";

/** Attach the gesture to a sheet element; returns the detach function. */
export function attachSwipeBack(el: HTMLElement, onBack: () => void, canGoBack: () => boolean = () => true): () => void {
  let start: { x: number; y: number } | null = null;
  let mode: "pending" | "drag" | "scroll" = "pending";
  let lastDx = 0;
  let samples: { t: number; x: number }[] = [];

  // The dimmed backdrop behind the sheet (Radix renders it just before the
  // content) lightens as the sheet slides, so the board comes into view
  // with the gesture rather than all at once when it ends.
  const backdrop = () => {
    const prev = el.previousElementSibling as HTMLElement | null | undefined;
    return prev && prev.hasAttribute("data-state") ? prev : null;
  };

  const now = (event: TouchEvent) => (event.timeStamp > 0 ? event.timeStamp : Date.now());

  const velocity = (): number => {
    const last = samples[samples.length - 1];
    if (!last) return 0;
    const first = samples.find((s) => last.t - s.t <= VELOCITY_WINDOW_MS);
    if (!first || last.t <= first.t) return 0;
    return (last.x - first.x) / (last.t - first.t);
  };

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1 || window.matchMedia("(min-width: 640px)").matches) {
      start = null;
      return;
    }
    const touch = event.touches[0];
    start = { x: touch.clientX, y: touch.clientY };
    mode = "pending";
    lastDx = 0;
    samples = [{ t: now(event), x: touch.clientX }];
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
        const bd = backdrop();
        if (bd) bd.style.transition = "none";
      } else {
        return;
      }
    }
    if (mode !== "drag") return;
    event.preventDefault();
    lastDx = Math.max(0, dx);
    samples.push({ t: now(event), x: touch.clientX });
    if (samples.length > 20) samples = samples.slice(-20);
    el.style.transform = `translateX(${lastDx}px)`;
    const bd = backdrop();
    if (bd) bd.style.opacity = String(Math.max(0, 1 - lastDx / Math.max(el.clientWidth, 1)));
  };

  const onTouchEnd = () => {
    if (!start) return;
    const wasDrag = mode === "drag";
    const dx = lastDx;
    const vx = wasDrag ? velocity() : 0;
    start = null;
    mode = "pending";
    if (!wasDrag) return;

    if (isBackSwipe(dx, vx) && canGoBack()) {
      // Complete the slide the finger started, then hand over to the
      // dialog's own close once the sheet is (nearly) off screen. The
      // exit animation is switched off first: a CSS animation outranks
      // the inline transform, so it would snap the sheet back to the
      // middle of the screen just to fade it out there — the "goes back
      // twice" bug. A refused close (canGoBack says no) falls into the
      // spring-back below instead of stranding the sheet off screen.
      const target = el.clientWidth + 48;
      const ms = slideOffMs(target - dx, vx);
      el.style.transition = `transform ${ms}ms ${SLIDE_EASING}`;
      el.style.transform = `translateX(${target}px)`;
      const bd = backdrop();
      if (bd) {
        bd.style.transition = `opacity ${ms}ms ${SLIDE_EASING}`;
        bd.style.opacity = "0";
      }
      window.setTimeout(() => {
        el.style.animation = "none";
        onBack();
      }, ms - 10);
    } else {
      el.style.transition = `transform 240ms ${SLIDE_EASING}`;
      el.style.transform = "translateX(0px)";
      const bd = backdrop();
      if (bd) {
        bd.style.transition = `opacity 240ms ${SLIDE_EASING}`;
        bd.style.opacity = "";
      }
      const clear = () => {
        el.style.transition = "";
        el.style.transform = "";
        if (bd) bd.style.transition = "";
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
}

/**
  Callback ref for a sheet that should close on a right swipe. Use it AS
  the element's ref — `ref={swipeRef}` — so the gesture arms the moment
  the sheet mounts and disarms when it unmounts.
*/
export function useSwipeBack(onBack: () => void, canGoBack: () => boolean = () => true) {
  const onBackRef = React.useRef(onBack);
  onBackRef.current = onBack;
  const canGoBackRef = React.useRef(canGoBack);
  canGoBackRef.current = canGoBack;
  const detachRef = React.useRef<(() => void) | null>(null);

  React.useEffect(
    () => () => {
      detachRef.current?.();
      detachRef.current = null;
    },
    [],
  );

  return React.useCallback((node: HTMLElement | null) => {
    detachRef.current?.();
    detachRef.current = node ? attachSwipeBack(node, () => onBackRef.current(), () => canGoBackRef.current()) : null;
  }, []);
}
