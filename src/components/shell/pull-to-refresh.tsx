"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/*
  Pull down to refresh, on every page: the board (each of its three
  columns), Ideas, Team and Settings. An installed web app has no browser
  refresh button, so this is the way to fetch what others have changed.

  It listens on the scrolling area under the header. A pull begins only when
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

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pull, setPull] = React.useState(0);
  const [phase, setPhase] = React.useState<"idle" | "pulling" | "refreshing">("idle");
  const [, startTransition] = React.useTransition();

  const mainRef = React.useRef<HTMLElement | null>(null);
  const routerRef = React.useRef(router);
  routerRef.current = router;
  const busy = React.useRef(false);

  const refresh = React.useCallback(async () => {
    const started = Date.now();
    const waits: Promise<unknown>[] = [];
    window.dispatchEvent(
      new CustomEvent<RefreshEventDetail>(REFRESH_EVENT, { detail: { wait: (work) => waits.push(work.catch(() => {})) } }),
    );
    // The page's own server data (Team, Ideas, Settings; the board's labels and people).
    waits.push(
      new Promise<void>((resolve) => {
        startTransition(() => {
          routerRef.current.refresh();
          // A transition has no "done" callback; the refresh lands within a frame or two of this.
          setTimeout(resolve, 450);
        });
      }),
    );
    await Promise.all(waits);
    const left = MIN_SPIN_MS - (Date.now() - started);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
  }, []);

  React.useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    let start: { x: number; y: number } | null = null;
    let mode: "pending" | "pull" | "other" = "pending";
    let pulled = 0;

    const content = () => main.firstElementChild as HTMLElement | null;
    const apply = (px: number, animate: boolean) => {
      const el = main;
      el.style.transition = animate ? `transform 260ms ${SETTLE_EASING}` : "none";
      el.style.transform = px ? `translateY(${px}px)` : "";
      setPull(px);
    };

    const onTouchStart = (e: TouchEvent) => {
      start = null;
      if (busy.current || e.touches.length !== 1) return;
      if (document.body.hasAttribute("data-board-dragging") || blockedStart(e.target)) return;
      if (!atTop(e.target, main)) return;
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
        if (!atTop(e.target, main)) return;
        mode = "pull";
        setPhase("pulling");
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
        setPhase("idle");
        return;
      }
      busy.current = true;
      setPhase("refreshing");
      apply(THRESHOLD_PX * 0.85, true);
      try {
        await refresh();
      } finally {
        apply(0, true);
        setPhase("idle");
        busy.current = false;
        void content();
      }
    };

    main.addEventListener("touchstart", onTouchStart, { passive: true });
    main.addEventListener("touchmove", onTouchMove, { passive: false });
    main.addEventListener("touchend", onTouchEnd);
    main.addEventListener("touchcancel", onTouchEnd);
    return () => {
      main.removeEventListener("touchstart", onTouchStart);
      main.removeEventListener("touchmove", onTouchMove);
      main.removeEventListener("touchend", onTouchEnd);
      main.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [refresh]);

  const progress = Math.min(pull / THRESHOLD_PX, 1);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
        style={{ height: Math.max(pull, 0), opacity: phase === "idle" && pull === 0 ? 0 : 1 }}
      >
        <span
          className={cn(
            "mt-2 flex h-9 w-9 items-center justify-center self-start rounded-full border border-border bg-card shadow-card",
            phase === "refreshing" && "animate-pulse",
          )}
          style={{ transform: `scale(${0.6 + 0.4 * progress})`, opacity: Math.min(1, progress * 1.4) }}
        >
          <RefreshCw
            className={cn("h-4 w-4 text-muted-foreground", phase === "refreshing" && "animate-spin")}
            style={phase === "refreshing" ? undefined : { transform: `rotate(${progress * 270}deg)` }}
          />
        </span>
      </div>
      <main
        id="main"
        ref={mainRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain"
      >
        {children}
      </main>
      <span role="status" aria-live="polite" className="sr-only">
        {phase === "refreshing" ? "Refreshing" : ""}
      </span>
    </div>
  );
}
