import * as React from "react";
import { releaseSpring, springEasing } from "@/components/ui/spring";
import { dragFrame, freezeAnimations, noteRelease, readFrame, restingFrame, type FrameBase } from "@/components/ui/zoom-transition";

/*
  Swipe right to go back, phone-style: the sheet follows the finger in
  real time, then either slides the rest of the way off or springs back
  if the swipe was short. Vertical scrolling must never trip it, so the
  gesture only takes over once the movement is clearly horizontal and
  rightward; from then on the sheet tracks the finger 1:1 until release.

  Phone sheets only: from `sm` up the dialog is a centred card whose
  position comes from a CSS translate, which an inline drag transform
  would fight — the gesture simply does not arm there.

  A sheet that zooms (the task sheet, see zoom-transition.ts) swipes the
  iOS way instead: it shrinks into a rounded card that follows the finger,
  and on release the dialog's close flies that card back into the task's
  card on the board — so the swipe and the landing read as one movement.
  The finger's speed at release is handed on: a flick sends the card home
  quickly, a slow release lets it settle, and a swipe too short to close
  springs back to full size with the same carried-over speed. Grabbing the
  sheet again while it is still moving picks it up exactly where it is.

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
export type SwipeBackOptions = { zoom?: boolean };

export function attachSwipeBack(
  el: HTMLElement,
  onBack: () => void,
  canGoBack: () => boolean = () => true,
  { zoom = false }: SwipeBackOptions = {},
): () => void {
  let start: { x: number; y: number } | null = null;
  let mode: "pending" | "drag" | "scroll" = "pending";
  let lastDx = 0;
  let lastDy = 0;
  let samples: { t: number; x: number; y: number }[] = [];
  // Zoom drags are drawn once per screen frame, however many touch events arrive.
  let frame = 0;
  // Where the finger found the sheet (null: at rest). A sheet grabbed mid-zoom carries on from there.
  let base: FrameBase | null = null;
  // Bumped by every new touch, so a finishing spring-back never clears a newer drag.
  let generation = 0;

  // The dimmed backdrop behind the sheet (Radix renders it just before the
  // content) lightens as the sheet slides, so the board comes into view
  // with the gesture rather than all at once when it ends.
  const backdrop = () => {
    const prev = el.previousElementSibling as HTMLElement | null | undefined;
    return prev && prev.hasAttribute("data-state") ? prev : null;
  };

  const now = (event: TouchEvent) => (event.timeStamp > 0 ? event.timeStamp : Date.now());

  /** Finger velocity over the last stretch of the swipe, px per ms. */
  const velocity = (): { vx: number; vy: number } => {
    const last = samples[samples.length - 1];
    if (!last) return { vx: 0, vy: 0 };
    const first = samples.find((s) => last.t - s.t <= VELOCITY_WINDOW_MS);
    if (!first || last.t <= first.t) return { vx: 0, vy: 0 };
    return { vx: (last.x - first.x) / (last.t - first.t), vy: (last.y - first.y) / (last.t - first.t) };
  };

  const drawZoom = () => {
    frame = 0;
    el.style.transformOrigin = "0 0";
    Object.assign(
      el.style,
      dragFrame({ left: 0, top: 0, width: el.clientWidth, height: el.clientHeight }, lastDx, lastDy, base ?? undefined),
    );
    const bd = backdrop();
    if (bd) bd.style.opacity = String(Math.max(0, 1 - lastDx / Math.max(el.clientWidth, 1)));
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
    lastDy = 0;
    generation++;
    samples = [{ t: now(event), x: touch.clientX, y: touch.clientY }];
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
        // Picks the sheet up wherever it is: still opening, or still springing back.
        base = null;
        if (zoom) {
          if (freezeAnimations(el) > 0) base = readFrame(el);
          const frozen = backdrop();
          if (frozen) freezeAnimations(frozen);
        }
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
    lastDy = dy;
    samples.push({ t: now(event), x: touch.clientX, y: touch.clientY });
    if (samples.length > 20) samples = samples.slice(-20);
    if (zoom) {
      if (!frame) frame = requestAnimationFrame(drawZoom);
      return;
    }
    el.style.transform = `translateX(${lastDx}px)`;
    const bd = backdrop();
    if (bd) bd.style.opacity = String(Math.max(0, 1 - lastDx / Math.max(el.clientWidth, 1)));
  };

  /**
    The sheet springs back to full size from where the finger left it, carrying the
    finger's own speed if it was already heading back. Gives up if grabbed again.
  */
  const springBack = (dx: number, vx: number) => {
    const mine = generation;
    const bd = backdrop();
    // px/ms leftwards, as whole trips back per second.
    const headingBack = Math.max(0, -vx) * 1000 / Math.max(dx, 1);
    const { easing, duration } = springEasing(releaseSpring(headingBack));
    const rest = restingFrame(0);
    const sheetAnim = el.animate([{}, { ...rest, opacity: 1 }], { duration, easing, fill: "forwards" });
    const backdropAnim = bd ? bd.animate([{}, { opacity: 1 }], { duration, easing, fill: "forwards" }) : null;
    sheetAnim.finished.then(
      () => {
        if (mine !== generation) return;
        sheetAnim.cancel();
        backdropAnim?.cancel();
        el.style.transition = "";
        el.style.transform = "";
        el.style.clipPath = "";
        el.style.opacity = "";
        el.style.transformOrigin = "";
        if (bd) {
          bd.style.transition = "";
          bd.style.opacity = "";
        }
      },
      () => {},
    );
  };

  const onTouchEnd = () => {
    if (!start) return;
    const wasDrag = mode === "drag";
    const dx = lastDx;
    const { vx, vy } = wasDrag ? velocity() : { vx: 0, vy: 0 };
    start = null;
    mode = "pending";
    if (!wasDrag) return;
    if (zoom && frame) {
      // The last move hasn't been drawn yet: draw it now, so release starts from where the finger is.
      cancelAnimationFrame(frame);
      drawZoom();
    }

    if (zoom && isBackSwipe(dx, vx) && canGoBack()) {
      // Left where the finger let go: the close flies it home from there, at the
      // speed the finger had. The CSS exit animation goes first, as below.
      noteRelease(el, { vx: vx * 1000, vy: vy * 1000 });
      el.style.animation = "none";
      onBack();
    } else if (zoom) {
      springBack(dx, vx);
    } else if (isBackSwipe(dx, vx) && canGoBack()) {
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
export function useSwipeBack(
  onBack: () => void,
  canGoBack: () => boolean = () => true,
  options: SwipeBackOptions = {},
) {
  const zoom = options.zoom ?? false;
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
    detachRef.current = node
      ? attachSwipeBack(node, () => onBackRef.current(), () => canGoBackRef.current(), { zoom })
      : null;
  }, [zoom]);
}
