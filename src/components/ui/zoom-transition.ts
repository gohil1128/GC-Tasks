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

  The timing is a spring (spring.ts), not a fixed time: a tap uses a fixed
  strong ease-out, but a swipe that lets go hands the sheet the speed the
  finger had (noteRelease), so a flick closes quickly and a gentle release
  settles gently, and the sheet never stops dead where the finger left it.

  Phones only, and only for sheets with no transform of their own (the full
  height sheets): a centred dialog positioned by a CSS translate, a desktop
  card, or a reader who prefers reduced motion keeps the plain fade.
*/

import { CLOSE_SPRING, OPEN_SPRING, releaseSpring, springEasing, type SpringKind } from "@/components/ui/spring";

export type Box = { left: number; top: number; width: number; height: number };

export type ZoomFrame = { transform: string; clipPath: string };


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

/** Where a sheet is when a finger takes hold of it: at rest, or caught partway through a zoom. */
export type FrameBase = { tx: number; ty: number; s: number; clipBottom: number; radius: number };

export const REST_BASE: FrameBase = { tx: 0, ty: 0, s: 1, clipBottom: 0, radius: 0 };

/**
  The sheet mid-swipe: smaller the further it has been pulled, its middle
  following the finger, its corners rounding as it becomes a card. `from` is
  where the finger found it, so a sheet grabbed halfway through opening goes on
  from exactly there instead of jumping to where a resting one would be.
*/
export function dragFrame(sheet: Box, dx: number, dy: number, from: FrameBase = REST_BASE): ZoomFrame {
  const progress = Math.min(1, Math.max(0, dx) / Math.max(sheet.width, 1));
  const shrink = 1 - 0.32 * progress;
  const s = from.s * shrink;
  const tx = from.tx + (sheet.width * from.s * (1 - shrink)) / 2 + Math.max(0, dx) * 0.55;
  const ty = from.ty + (sheet.height * from.s * (1 - shrink)) / 2 + dy * 0.45;
  const radius = Math.min(36, Math.max(from.radius, 10 + progress * 120));
  return {
    transform: `translate(${round(tx)}px, ${round(ty)}px) scale(${round(s, 4)})`,
    clipPath: `inset(0px 0px ${round(from.clipBottom)}px 0px round ${round(radius / s)}px)`,
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
  const { easing, duration } = springEasing(OPEN_SPRING);
  el.style.transformOrigin = "0 0";
  // Own layer for the flight, so the sheet's content is not repainted every frame.
  el.style.willChange = "transform, clip-path, opacity";
  const anim = el.animate(
    [
      { ...start, opacity: 0.55 },
      { opacity: 1, offset: 0.35 },
      { ...end, opacity: 1 },
    ],
    { duration, easing },
  );
  const held = [anim];
  anim.finished.then(
    () => {
      el.style.transformOrigin = "";
      el.style.willChange = "";
    },
    () => {},
  );
  if (backdrop) {
    backdrop.style.animation = "none";
    held.push(backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing }));
  }
  startAfterFirstPaint(held);
  return true;
}

// ── How fast the finger was going ───────────────────────────────────────────

/** Finger velocity at the moment of release, in px per second. */
export type Release = { vx: number; vy: number };

const releases = new WeakMap<HTMLElement, Release>();

/** The swipe that is about to close this sheet lets go at this velocity; the next zoomOut uses it. */
export function noteRelease(el: HTMLElement, release: Release): void {
  releases.set(el, release);
}

/**
  How urgent the release was, as whole journeys per second: the finger's speed in
  any direction, per px of the way still to go. Any direction, because a swipe
  back goes right while the card it returns to is off to the left, so the speed
  that matters is "how hard was it thrown", not "how much of it points at the card".
*/
export function journeysPerSecond(release: Release | undefined, from: { x: number; y: number }, to: { x: number; y: number }): number {
  if (!release) return 0;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance < 1) return 0;
  return Math.hypot(release.vx, release.vy) / distance;
}

/** Stops anything still running on the sheet, keeping it exactly where it had got to. Returns how many it stopped. */
export function freezeAnimations(el: HTMLElement): number {
  const running = el.getAnimations();
  for (const anim of running) {
    try {
      anim.commitStyles();
    } catch {
      // Not rendered: nothing to keep.
    }
    anim.cancel();
  }
  return running.length;
}

/** The sheet's current frame, read back from the styles a frozen animation left (null if it is simply at rest). */
export function readFrame(el: HTMLElement): FrameBase | null {
  const transform = getComputedStyle(el).transform;
  if (!transform || transform === "none") return null;
  const m = new DOMMatrixReadOnly(transform);
  const s = m.a;
  if (!Number.isFinite(s) || s <= 0) return null;
  // inset(<top> <right> <bottom> <left> round <radius>), all in the sheet's own (unscaled) pixels.
  const clip = /inset\(\s*([-\d.]+)px\s+([-\d.]+)px\s+([-\d.]+)px\s+([-\d.]+)px(?:\s+round\s+([-\d.]+)px)?/.exec(el.style.clipPath);
  const clipBottom = clip ? Number(clip[3]) : 0;
  const radius = clip && clip[5] ? Number(clip[5]) * s : 0;
  return { tx: m.e, ty: m.f, s, clipBottom: Math.max(0, clipBottom), radius };
}

/**
  Holds freshly made animations back until the sheet's content has been built and
  painted once. Mounting a task takes a long first frame (60-80ms), and an animation
  that is already running through it arrives at its first visible frame a quarter of
  the way in: the start looks like a leap. Paused at its first frame, the sheet sits
  on the card for that frame, then moves from the beginning.
*/
function startAfterFirstPaint(animations: Animation[]): void {
  for (const anim of animations) anim.pause();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const anim of animations) if (anim.playState === "paused") anim.play();
    }),
  );
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
  freezeAnimations(el);
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

  // How the finger was moving as it let go decides how the sheet moves on. A plain
  // close (a tap, Back, Escape) has no finger, so it gets the standard spring.
  const release = releases.get(el);
  releases.delete(el);
  let spring: SpringKind = CLOSE_SPRING;
  if (release) {
    const here = el.getBoundingClientRect();
    const goal = to ?? { left: sheet.left, top: sheet.top, width: sheet.width, height: sheet.height };
    spring = releaseSpring(
      journeysPerSecond(
        release,
        { x: here.left + here.width / 2, y: here.top + here.height / 2 },
        { x: goal.left + goal.width / 2, y: goal.top + goal.height / 2 },
      ),
    );
  }
  const { easing, duration } = springEasing(spring);

  el.style.transformOrigin = "0 0";
  el.style.pointerEvents = "none";
  el.style.willChange = "transform, clip-path, opacity";
  const backdrop = backdropOf(el);
  const anim = el.animate(
    to
      ? [{}, { opacity: 1, offset: 0.7 }, { ...end, opacity: 0 }]
      : [{}, { ...end, opacity: 0 }],
    { duration, easing, fill: "forwards" },
  );
  let backdropAnim: Animation | null = null;
  if (backdrop) {
    backdrop.style.animation = "none";
    backdropAnim = backdrop.animate([{}, { opacity: 0 }], { duration, easing, fill: "forwards" });
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
      el.style.willChange = "";
      if (backdrop) {
        backdrop.style.opacity = "";
        backdrop.style.animation = "";
      }
    },
  };
}
