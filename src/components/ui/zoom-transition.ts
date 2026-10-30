/*
  The phone's "zoom" transition, as in iOS: the task sheet grows out of the
  card that was tapped and, when it closes, shrinks back into it. A swipe-back shrinks the sheet into a rounded card
  under the finger first (see swipe-back.ts); the close then flies that card
  home from wherever the finger left it.

  How the shape works: the sheet is scaled uniformly — never stretched, so
  its text stays legible mid-flight — until it is as wide as the source,
  moved onto it, and clipped (clip-path inset, with the source's rounded
  corners) to the source's height. Animating to and from that frame is the
  whole transition.

  Phones only, and only for sheets with no transform of their own (the full
  height sheets): a centred dialog positioned by a CSS translate, a desktop
  card, or a reader who prefers reduced motion keeps the plain fade.
*/

export type Box = { left: number; top: number; width: number; height: number };

export type ZoomFrame = { transform: string; clipPath: string };

export const ZOOM_OPEN_MS = 420;
export const ZOOM_CLOSE_MS = 360;
const OPEN_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const CLOSE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

/** The sheet drawn exactly over `source`: scaled to its width, clipped to its height and corners. */
export function zoomFrame(sheet: Box, source: Box, sourceRadius: number): ZoomFrame {
  const k = source.width / Math.max(sheet.width, 1);
  const clipBottom = Math.max(0, sheet.height - source.height / Math.max(k, 0.0001));
  return {
    transform: `translate(${round(source.left - sheet.left)}px, ${round(source.top - sheet.top)}px) scale(${round(k, 4)})`,
    clipPath: `inset(0px 0px ${round(clipBottom)}px 0px round ${round(sourceRadius / Math.max(k, 0.0001))}px)`,
  };
}

/** The sheet as it rests, in the same shape as zoomFrame so the two interpolate. */
export function restingFrame(radius: number): ZoomFrame {
  return { transform: "translate(0px, 0px) scale(1)", clipPath: `inset(0px 0px 0px 0px round ${round(radius)}px)` };
}

/**
  Where a sheet goes when it has nowhere to fly back to (the card left the
  screen, the button is gone): it shrinks a little toward its middle and
  fades, the iOS fallback.
*/
export function fallbackFrame(sheet: Box, radius: number): ZoomFrame {
  const s = 0.86;
  return {
    transform: `translate(${round((sheet.width * (1 - s)) / 2)}px, ${round((sheet.height * (1 - s)) / 2)}px) scale(${s})`,
    clipPath: `inset(0px 0px 0px 0px round ${round(Math.max(radius, 28) / s)}px)`,
  };
}

/**
  The sheet mid-swipe: smaller the further it has been pulled, its middle
  following the finger, its corners rounding as it becomes a card.
*/
export function dragFrame(sheet: Box, dx: number, dy: number): ZoomFrame {
  const progress = Math.min(1, Math.max(0, dx) / Math.max(sheet.width, 1));
  const s = 1 - 0.32 * progress;
  const tx = (sheet.width * (1 - s)) / 2 + Math.max(0, dx) * 0.55;
  const ty = (sheet.height * (1 - s)) / 2 + dy * 0.45;
  const radius = Math.min(36, 10 + progress * 120);
  return {
    transform: `translate(${round(tx)}px, ${round(ty)}px) scale(${round(s, 4)})`,
    clipPath: `inset(0px 0px 0px 0px round ${round(radius / s)}px)`,
  };
}

function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

// ── DOM side ────────────────────────────────────────────────────────────────

export function prefersZoom(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  if (window.matchMedia("(min-width: 640px)").matches) return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  return typeof HTMLElement.prototype.animate === "function";
}

/** An element's on-screen box, if it is on screen and big enough to fly to. */
export function visibleBox(el: Element | null | undefined): Box | null {
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return null;
  if (r.bottom <= 0 || r.right <= 0 || r.top >= window.innerHeight || r.left >= window.innerWidth) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function radiusOf(el: Element | null | undefined): number {
  if (!el) return 0;
  return parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
}

/** The dimmed backdrop Radix renders just before the sheet. */
export function backdropOf(el: HTMLElement): HTMLElement | null {
  const prev = el.previousElementSibling as HTMLElement | null;
  return prev && prev.hasAttribute("data-state") ? prev : null;
}

/**
  The sheet's resting box, measured with any gesture transform lifted for
  the moment of measuring. Null when the sheet is positioned by a transform
  of its own, which the zoom would fight — those keep the plain fade.
*/
function restingBox(el: HTMLElement): Box | null {
  const inline = el.style.transform;
  el.style.transform = "";
  const own = getComputedStyle(el).transform;
  const r = el.getBoundingClientRect();
  el.style.transform = inline;
  if (own !== "none") return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** Grows a sheet that has just mounted out of `source`. Returns false if it could not. */
export function zoomIn(el: HTMLElement, source: Element | null): boolean {
  const from = visibleBox(source);
  if (!from) return false;
  el.style.animation = "none";
  const sheet = restingBox(el);
  if (!sheet) {
    el.style.animation = "";
    return false;
  }
  const backdrop = backdropOf(el);
  const radius = radiusOf(el);
  const start = zoomFrame(sheet, from, radiusOf(source));
  const end = restingFrame(radius);
  el.style.transformOrigin = "0 0";
  const anim = el.animate(
    [
      { ...start, opacity: 0.55 },
      { opacity: 1, offset: 0.35 },
      { ...end, opacity: 1 },
    ],
    { duration: ZOOM_OPEN_MS, easing: OPEN_EASING },
  );
  anim.finished.then(
    () => {
      el.style.transformOrigin = "";
    },
    () => {},
  );
  if (backdrop) {
    backdrop.style.animation = "none";
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ZOOM_OPEN_MS, easing: OPEN_EASING });
  }
  return true;
}

export type ZoomOut = { cancel: () => void };

/**
  Shrinks the sheet back into `target` (or, with none, toward its middle as
  it fades), starting from wherever it is now — mid-swipe included — and
  calls `done` once it has landed. Null when this sheet cannot zoom; the
  caller closes it the ordinary way.
*/
export function zoomOut(el: HTMLElement, target: Element | null, done: () => void): ZoomOut | null {
  // Freeze anything still running (an opening zoom, a spring-back) where it is.
  for (const anim of el.getAnimations()) {
    try {
      anim.commitStyles();
    } catch {
      // Not rendered: nothing to keep.
    }
    anim.cancel();
  }
  const animation = el.style.animation;
  el.style.transition = "none";
  el.style.animation = "none";
  const sheet = restingBox(el);
  if (!sheet) {
    el.style.animation = animation;
    return null;
  }
  const to = visibleBox(target);
  const end = to ? zoomFrame(sheet, to, radiusOf(target)) : fallbackFrame(sheet, radiusOf(el));
  if (!el.style.transform) Object.assign(el.style, restingFrame(radiusOf(el)));
  el.style.transformOrigin = "0 0";
  el.style.pointerEvents = "none";
  const backdrop = backdropOf(el);
  const anim = el.animate(
    to
      ? [{}, { opacity: 1, offset: 0.7 }, { ...end, opacity: 0 }]
      : [{}, { ...end, opacity: 0 }],
    { duration: ZOOM_CLOSE_MS, easing: CLOSE_EASING, fill: "forwards" },
  );
  let backdropAnim: Animation | null = null;
  if (backdrop) {
    backdrop.style.animation = "none";
    backdropAnim = backdrop.animate([{}, { opacity: 0 }], { duration: ZOOM_CLOSE_MS, easing: CLOSE_EASING, fill: "forwards" });
  }
  let cancelled = false;
  anim.finished.then(
    () => {
      if (!cancelled) done();
    },
    () => {},
  );
  return {
    cancel() {
      cancelled = true;
      anim.cancel();
      backdropAnim?.cancel();
      el.style.transform = "";
      el.style.clipPath = "";
      el.style.transformOrigin = "";
      el.style.pointerEvents = "";
      el.style.transition = "";
      if (backdrop) {
        backdrop.style.opacity = "";
        backdrop.style.animation = "";
      }
    },
  };
}
