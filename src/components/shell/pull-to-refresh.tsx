"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/*
  Pull down to refresh, on every page. An installed web app has no browser
  refresh button, so this is the way to fetch what others have changed.

  Two places use it. On Ideas, Team and Settings the whole page under the
  header moves (PullToRefresh, which renders <main>). On the board only the
  column under the finger moves — the title, search, filters and tab bar stay
  put — so the board opts out of the page-wide pull (data-own-pull) and wires
  usePullToRefresh to its columns itself.

  A pull begins only when
  the finger lands with nothing above it left to scroll (the column or page
  is at its top) and moves clearly downward; from then on the content
  follows the finger with resistance, an indicator turns as the pull grows,
  and letting go past the threshold refreshes. Anything else — scrolling
  back up a long list, a sideways swipe between columns, a card being
  dragged, typing in a field — is left alone.

  Refreshing = every listener of REFRESH_EVENT gets to say what it is
  waiting on (the board refetches its tasks), and the page's server data is
  re-read with router.refresh(). The indicator stays until both are done,
  for at least a moment so it never just flashes.

  Everything while the finger is down is written straight to the DOM (the
  moving element's transform, the indicator's size and spin), so a pull
  costs no React renders — on the board that would be the whole board, every
  frame.
*/

export const REFRESH_EVENT = "gc:refresh";
export type RefreshEventDetail = { wait: (work: Promise<unknown>) => void };

const ARM_PX = 10;
const THRESHOLD_PX = 60;
const MAX_PULL_PX = 110;
const RESISTANCE = 0.55;
const MIN_SPIN_MS = 600;
const SETTLE_EASING = "cubic-bezier(0.32, 0.72, 0.35, 1)";

/** The pull distance the finger's travel turns into: 1:1-ish at first, then easing off towards a ceiling. */
export function pullDistance(dy: number): number {
  const d = Math.max(dy, 0) * RESISTANCE;
  return MAX_PULL_PX * (1 - Math.exp(-d / MAX_PULL_PX));
}

export function shouldRefresh(pulled: number): boolean {
  return pulled >= THRESHOLD_PX;
}

/** True when nothing between the touched element and `root` can still scroll up. */
function atTop(target: EventTarget | null, root: HTMLElement): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== root.parentElement) {
    if (el instanceof HTMLElement) {
      const overflowY = getComputedStyle(el).overflowY;
      const scrollable = (overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight;
      if (scrollable && el.scrollTop > 0) return false;
    }
    if (el === root) break;
    el = el.parentElement;
  }
  return true;
}

/**
 * Not a pull: the finger is on something that handles its own drags. A text
 * field only counts while it is being edited (an idle one, like the quick-add
 * row at the top of a column, is just somewhere to put a finger).
 */
function blockedStart(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("[data-no-swipe], [data-no-pull]")) return true;
  const field = target.closest("input, textarea, select, [contenteditable=true]");
  return !!field && field === document.activeElement;
}

/** Re-read everything: whoever listens for REFRESH_EVENT (the board's tasks), and the page's server data. */
export async function refreshEverything(router: { refresh: () => void }): Promise<void> {
  const started = Date.now();
  const waits: Promise<unknown>[] = [];
  window.dispatchEvent(
    new CustomEvent<RefreshEventDetail>(REFRESH_EVENT, { detail: { wait: (work) => waits.push(work.catch(() => {})) } }),
  );
  waits.push(
    new Promise<void>((resolve) => {
      React.startTransition(() => router.refresh());
      // A transition has no "done" callback; the refresh lands within a frame or two of this.
      setTimeout(resolve, 450);
    }),
  );
  await Promise.all(waits);
  const left = MIN_SPIN_MS - (Date.now() - started);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}

type PullOptions = {
  /** The element that moves with the finger, chosen from where the touch began (null: no pull here). */
  getTarget: (touched: Element) => HTMLElement | null;
  /** The PullIndicator to drive. */
  getIndicator: () => HTMLElement | null;
  onRefresh: () => Promise<void>;
  /** Touches this listener should leave alone (somebody else handles them). */
  skip?: (touched: Element) => boolean;
};

/** Drives a PullIndicator directly: its height follows the pull, the icon turns, then spins while refreshing. */
function drawIndicator(indicator: HTMLElement | null, px: number, refreshing: boolean) {
  if (!indicator) return;
  const progress = Math.min(px / THRESHOLD_PX, 1);
  indicator.style.height = `${Math.max(px, 0)}px`;
  indicator.style.opacity = px > 0 || refreshing ? "1" : "0";
  if (refreshing) indicator.setAttribute("data-refreshing", "true");
  else indicator.removeAttribute("data-refreshing");
  const dot = indicator.firstElementChild as HTMLElement | null;
  if (dot) {
    dot.style.transform = `scale(${0.6 + 0.4 * (refreshing ? 1 : progress)})`;
    dot.style.opacity = String(refreshing ? 1 : Math.min(1, progress * 1.4));
    const icon = dot.firstElementChild as SVGElement | null;
    if (icon) icon.style.transform = refreshing ? "" : `rotate(${progress * 270}deg)`;
  }
  const status = indicator.querySelector("[role=status]");
  if (status) status.textContent = refreshing ? "Refreshing" : "";
}

/**
 * Pull to refresh on whatever element the returned ref is put on. Stable: the
 * ref and its listeners do not change between renders.
 */
export function usePullToRefresh(options: PullOptions): (root: HTMLElement | null) => void {
  const latest = React.useRef(options);
  latest.current = options;
  const detach = React.useRef<(() => void) | null>(null);

  return React.useCallback((root: HTMLElement | null) => {
    detach.current?.();
    detach.current = null;
    if (!root) return;

    let start: { x: number; y: number } | null = null;
    let mode: "pending" | "pull" | "other" = "pending";
    let pulled = 0;
    let moving: HTMLElement | null = null;
    let busy = false;

    const apply = (px: number, animate: boolean, refreshing = false) => {
      if (moving) {
        moving.style.transition = animate ? `transform 260ms ${SETTLE_EASING}` : "none";
        moving.style.transform = px ? `translateY(${px}px)` : "";
      }
      drawIndicator(latest.current.getIndicator(), px, refreshing);
    };

    const onTouchStart = (e: TouchEvent) => {
      start = null;
      if (busy || e.touches.length !== 1 || !(e.target instanceof Element)) return;
      if (document.body.hasAttribute("data-board-dragging") || blockedStart(e.target)) return;
      if (latest.current.skip?.(e.target)) return;
      const target = latest.current.getTarget(e.target);
      if (!target || !atTop(e.target, target)) return;
      moving = target;
      const t = e.touches[0]!;
      start = { x: t.clientX, y: t.clientY };
      mode = "pending";
      pulled = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!start) return;
      if (e.defaultPrevented || document.body.hasAttribute("data-board-dragging")) {
        if (mode === "pull") apply(0, true);
        start = null;
        return;
      }
      const t = e.touches[0]!;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (mode === "pending") {
        // Up, or more across than down: not a pull, for the rest of this touch.
        if (dy < -4 || (Math.abs(dx) > ARM_PX && Math.abs(dx) > Math.abs(dy))) {
          mode = "other";
          return;
        }
        if (dy < ARM_PX) return;
        // Something scrolled up under the finger while it was pending (momentum): wait for the top.
        if (!moving || !atTop(e.target, moving)) return;
        mode = "pull";
      }
      if (mode !== "pull") return;
      e.preventDefault();
      pulled = pullDistance(dy - ARM_PX);
      apply(pulled, false);
    };

    const onTouchEnd = async () => {
      if (!start) return;
      const was = mode;
      start = null;
      mode = "pending";
      if (was !== "pull") return;
      if (!shouldRefresh(pulled)) {
        apply(0, true);
        return;
      }
      busy = true;
      apply(THRESHOLD_PX * 0.85, true, true);
      try {
        await latest.current.onRefresh();
      } finally {
        apply(0, true);
        busy = false;
      }
    };

    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd);
    root.addEventListener("touchcancel", onTouchEnd);
    detach.current = () => {
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);
}

/** The spinner in the gap a pull opens. Drawn by usePullToRefresh; place it at the top of the area that moves. */
export const PullIndicator = React.forwardRef<HTMLDivElement, { className?: string }>(function PullIndicator(
  { className },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn("group pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center", className)}
      style={{ height: 0, opacity: 0 }}
    >
      <span
        aria-hidden
        className="mt-2 flex h-9 w-9 items-center justify-center self-start rounded-full border border-border bg-card shadow-card group-data-[refreshing=true]:animate-pulse"
      >
        <RefreshCw className="h-4 w-4 text-muted-foreground group-data-[refreshing=true]:animate-spin" />
      </span>
      <span role="status" aria-live="polite" className="sr-only" />
    </div>
  );
});

/** The page-wide pull for Ideas, Team and Settings (the board does its own; see the note at the top). */
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const indicator = React.useRef<HTMLDivElement | null>(null);
  const main = React.useRef<HTMLElement | null>(null);
  const pullRef = usePullToRefresh({
    getTarget: () => main.current,
    getIndicator: () => indicator.current,
    onRefresh: () => refreshEverything(router),
    skip: (touched) => !!touched.closest("[data-own-pull]"),
  });
  const mainRef = React.useCallback(
    (el: HTMLElement | null) => {
      main.current = el;
      pullRef(el);
    },
    [pullRef],
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <PullIndicator ref={indicator} />
      <main id="main" ref={mainRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain">
        {children}
      </main>
    </div>
  );
}
