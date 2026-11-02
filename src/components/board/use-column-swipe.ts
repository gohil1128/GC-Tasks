import * as React from "react";
import { STATUSES, type Status } from "@/modules/tasks/types";

/*
  The phone board as a carousel: To do, In progress and Done sit side by side
  on a track, and the track follows the finger — so the next column is already
  there, sliding into view as you swipe, and the pill in the tab bar above
  glides along with it instead of jumping when the swipe ends.

  Everything while the finger is down or the column is settling is written
  straight to the DOM (a transform on the track and on the pill), so a swipe
  costs no React renders. React only hears about it once, at the end, through
  `onChange`. Position is a fractional column index, `pos` (0 = To do, 1 = In
  progress, 2 = Done, 0.5 = halfway between); both transforms are functions of
  it, in percentages and the fixed gaps, so they stay right if the screen is
  resized or rotated.

  Letting go carries on from where the finger was, at the speed it had: a
  flick settles quickly, a slow drag settles slowly. The new column is current
  the moment the finger lifts, and a touch while the board is still sliding
  catches it where it is, so quick swipes chain without waiting to land.

  It has to stay out of the way of everything else a thumb does here:
    - scrolling a column: the gesture arms only once the movement is clearly
      sideways, and a touch that starts out vertical is a scroll for good;
    - dragging a card: when a card drag is under way (`enabled` is false) the
      carousel steps aside completely — the other columns are hidden and the
      track is flat, which is the layout drag-and-drop was built for;
    - the phone's own back gesture from the screen edge: touches starting
      within EDGE_PX of either side are left to the system;
    - typing: a touch starting in a text field, or on [data-no-swipe], is ignored.
  From md up all three columns are laid out in a grid and none of this runs.
*/

export const COLUMN_SWIPE_MIN_X = 60;
export const COLUMN_FLICK_MIN_X = 24;
/** px per ms over the last stretch of the swipe. */
export const COLUMN_FLICK_VELOCITY = 0.4;
const ARM_PX = 12;
const EDGE_PX = 20;
const VELOCITY_WINDOW_MS = 100;
/** gap-4 between columns on the track, and gap-1 between the tabs. Keep in step with board.tsx / column-tabs.tsx. */
const GAP_PX = 16;
const PILL_GAP_PX = 4;
const LAST = STATUSES.length - 1;
const SETTLE_EASING = "cubic-bezier(0.22, 0.8, 0.3, 1)";
/** A tab tap or a card dragged to another column's tab: a calm, fixed slide. */
const PROGRAMMATIC_MS = 300;

/** Someone who asked their phone for less motion gets the column (and its tab pill) placed, not glided. */
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

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

/**
 * How long the track takes to cover the rest of its way. It carries on at the
 * speed the finger had (floored, so a dead-slow release still arrives), kept
 * inside a range that never feels abrupt or sluggish.
 */
export function carouselSettleMs(remainingPx: number, velocityX: number): number {
  const speed = Math.max(Math.abs(velocityX), 0.8); // px per ms
  return Math.round(Math.min(360, Math.max(140, remainingPx / speed)));
}

/** Past the first or last column the track gives, but only a quarter as far as the finger. */
export function rubberBand(pos: number): number {
  if (pos < 0) return pos * 0.25;
  if (pos > LAST) return LAST + (pos - LAST) * 0.25;
  return pos;
}

const trackTransform = (pos: number) => `translateX(calc(${-pos * 100}% - ${pos * GAP_PX}px))`;
const pillTransform = (pos: number) => `translateX(calc(${pos * 100}% + ${pos * PILL_GAP_PX}px))`;

function startsInsideNoSwipe(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest("input, textarea, select, [contenteditable=true], [data-no-swipe]");
}

export function useColumnSwipe({
  current,
  onChange,
  isDragging,
  enabled,
  getPill,
}: {
  current: Status;
  onChange: (status: Status) => void;
  /** A card drag is under way right now (read at touch time, so it can be a ref). */
  isDragging: () => boolean;
  /** False while a card is being dragged: the track lies flat and the gesture is off. */
  enabled: boolean;
  /** The highlight pill in the tab bar, which moves with the track. */
  getPill: () => HTMLElement | null;
}): (el: HTMLElement | null) => void {
  const latest = React.useRef({ current, onChange, isDragging, enabled, getPill });
  latest.current = { current, onChange, isDragging, enabled, getPill };

  const viewport = React.useRef<HTMLElement | null>(null);
  /** Where the carousel logically is (a fractional column index); animations run towards it. */
  const pos = React.useRef(STATUSES.indexOf(current));
  const animations = React.useRef<Animation[]>([]);
  const detach = React.useRef<(() => void) | null>(null);

  // Found by its marker, not its position: other things share the viewport (the pull-to-refresh spinner).
  const track = () => viewport.current?.querySelector<HTMLElement>(":scope > [data-column-track]") ?? null;
  const isPhone = () => !window.matchMedia("(min-width: 768px)").matches;

  /** Writes `p` to the pill and, when the carousel is live, to the track; and lights the nearest tab. */
  const place = React.useCallback((p: number, scrubbing: boolean, lit: number = p) => {
    const pill = latest.current.getPill();
    const t = track();
    if (pill) {
      pill.style.transform = pillTransform(p);
      const group = pill.parentElement;
      if (group) {
        if (scrubbing) group.setAttribute("data-scrubbing", "true");
        else group.removeAttribute("data-scrubbing");
        const nearest = Math.round(Math.min(Math.max(lit, 0), LAST));
        group.querySelectorAll<HTMLElement>("[data-column-tab]").forEach((tab, i) => {
          if (i === nearest) tab.setAttribute("data-lit", "true");
          else tab.removeAttribute("data-lit");
        });
      }
    }
    if (t) t.style.transform = latest.current.enabled ? trackTransform(p) : "";
  }, []);

  const stopAnimations = React.useCallback(() => {
    animations.current.forEach((a) => {
      a.onfinish = null;
      a.oncancel = null;
      a.cancel();
    });
    animations.current = [];
  }, []);

  /** Where the carousel visibly is right now, mid-animation included. */
  const visiblePos = React.useCallback((): number => {
    const t = track();
    const v = viewport.current;
    if (!t || !v || animations.current.length === 0) return pos.current;
    const base = v.getBoundingClientRect().left + parseFloat(getComputedStyle(v).paddingLeft);
    const step = t.offsetWidth + GAP_PX;
    return step > 0 ? (base - t.getBoundingClientRect().left) / step : pos.current;
  }, []);

  /** Slide the pill (and the track, when live) from where they are to `to`. */
  const settle = React.useCallback(
    (to: number, ms: number, after?: () => void) => {
      const t = track();
      const pill = latest.current.getPill();
      const from = visiblePos();
      stopAnimations();
      pos.current = to;
      if (ms <= 0 || from === to || prefersReducedMotion() || typeof (t ?? pill)?.animate !== "function") {
        place(to, false);
        after?.();
        return;
      }
      // The label it is heading for turns dark as it sets off, not when it arrives.
      place(from, true, to);
      const run: Animation[] = [];
      const options = { duration: ms, easing: SETTLE_EASING, fill: "forwards" as const };
      if (t && latest.current.enabled) {
        run.push(t.animate([{ transform: trackTransform(from) }, { transform: trackTransform(to) }], options));
      }
      if (pill) run.push(pill.animate([{ transform: pillTransform(from) }, { transform: pillTransform(to) }], options));
      animations.current = run;
      const first = run[0];
      if (!first) {
        place(to, false);
        after?.();
        return;
      }
      first.onfinish = () => {
        // Land the real styles first, then drop the animations, so nothing flickers.
        place(to, false);
        stopAnimations();
        after?.();
      };
    },
    [place, stopAnimations, visiblePos],
  );

  // Something other than a swipe moved the column (a tab tap, a card dragged to
  // a tab), or the carousel was switched on or off: bring the pill and track along.
  const index = STATUSES.indexOf(current);
  React.useLayoutEffect(() => {
    if (!isPhone()) {
      stopAnimations();
      const t = track();
      if (t) t.style.transform = "";
      return;
    }
    if (pos.current === index) {
      // A swipe already on its way here (React heard about it on release): let it land.
      if (animations.current.length === 0) place(index, false);
      return;
    }
    // Instant while a card is held: drag-and-drop re-measures on its own schedule.
    settle(index, enabled ? PROGRAMMATIC_MS : 0);
  }, [index, enabled, place, settle, stopAnimations]);

  // Rotating the phone or resizing across the md line.
  React.useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      stopAnimations();
      if (query.matches) {
        const t = track();
        if (t) t.style.transform = "";
        latest.current.getPill()?.style.removeProperty("transform");
      } else {
        place(STATUSES.indexOf(latest.current.current), false);
      }
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [place, stopAnimations]);

  return React.useCallback(
    (el: HTMLElement | null) => {
      detach.current?.();
      detach.current = null;
      viewport.current = el;
      if (!el) return;

      let start: { x: number; y: number } | null = null;
      let mode: "pending" | "swipe" | "other" = "pending";
      let basePos = 0;
      let stepPx = 1;
      let dragPos = 0;
      let samples: { t: number; x: number }[] = [];
      /** This touch caught the board mid-slide. */
      let caught = false;
      const currentIndex = () => STATUSES.indexOf(latest.current.current);

      const now = (event: TouchEvent) => (event.timeStamp > 0 ? event.timeStamp : Date.now());
      const velocity = (): number => {
        const last = samples[samples.length - 1];
        if (!last) return 0;
        const first = samples.find((s) => last.t - s.t <= VELOCITY_WINDOW_MS);
        if (!first || last.t <= first.t) return 0;
        return (last.x - first.x) / (last.t - first.t);
      };

      const onTouchStart = (event: TouchEvent) => {
        start = null;
        const live = latest.current;
        if (!live.enabled || event.touches.length !== 1 || !isPhone()) return;
        if (live.isDragging() || startsInsideNoSwipe(event.target)) return;
        const touch = event.touches[0]!;
        if (touch.clientX < EDGE_PX || touch.clientX > window.innerWidth - EDGE_PX) return;
        const t = track();
        if (!t) return;
        // Still sliding from the last swipe: catch it where it is, so swipes can follow each
        // other without waiting for the board to land.
        caught = animations.current.length > 0;
        if (caught) {
          basePos = visiblePos();
          stopAnimations();
          pos.current = basePos;
          place(basePos, true, currentIndex());
        } else {
          basePos = pos.current;
        }
        stepPx = t.offsetWidth + GAP_PX;
        dragPos = basePos;
        start = { x: touch.clientX, y: touch.clientY };
        mode = "pending";
        samples = [{ t: now(event), x: touch.clientX }];
      };

      const onTouchMove = (event: TouchEvent) => {
        if (!start) return;
        if (latest.current.isDragging() || !latest.current.enabled) {
          if (mode === "swipe" || caught) settle(currentIndex(), 0);
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
        dragPos = basePos - dx / stepPx;
        place(rubberBand(dragPos), true);
      };

      const onTouchEnd = () => {
        if (!start) return;
        const wasSwipe = mode === "swipe";
        const fingerPos = dragPos;
        const vx = wasSwipe ? velocity() : 0;
        start = null;
        mode = "pending";
        if (!wasSwipe) {
          // Caught mid-slide by a tap or a scroll: finish the slide to the column it was going to.
          if (caught) settle(currentIndex(), carouselSettleMs(Math.abs(currentIndex() - basePos) * stepPx, 0));
          return;
        }

        const from = Math.round(basePos);
        const dx = (basePos - fingerPos) * stepPx; // finger travel in px; negative = leftwards
        const target = latest.current.isDragging() ? null : columnAfterSwipe(STATUSES[from] ?? "TODO", dx, vx);
        const to = target ? STATUSES.indexOf(target) : from;
        const shown = rubberBand(fingerPos);
        // Pick up from where the finger let go: rewrite the transform to the same place, then animate on.
        pos.current = shown;
        const ms = carouselSettleMs(Math.abs(to - shown) * stepPx, vx);
        settle(to, ms);
        // React hears now, not when the slide lands, so the board is never "between" columns as
        // far as the app is concerned and the next swipe can start straight away. The slide is a
        // compositor animation, so the re-render does not interrupt it.
        const toStatus = STATUSES[to];
        if (toStatus && toStatus !== latest.current.current) latest.current.onChange(toStatus);
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
    },
    [place, settle, stopAnimations, visiblePos],
  );
}
