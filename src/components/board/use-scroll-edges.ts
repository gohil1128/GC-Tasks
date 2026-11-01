import * as React from "react";

/**
 * Keeps `data-scrolled` (scrolled away from the top) and `data-more` (more
 * below) on a scroll box, for the `.scroll-fade` edges (and `.scroll-fade-bottom`). Written straight to
 * the element, once a frame at most, so scrolling re-renders nothing. Also
 * re-checked when the content changes size (cards added, moved or filtered).
 */
export function useScrollEdges(): (el: HTMLElement | null) => void {
  const detach = React.useRef<(() => void) | null>(null);
  return React.useCallback((el: HTMLElement | null) => {
    detach.current?.();
    detach.current = null;
    if (!el) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const scrolled = el.scrollTop > 2;
      const more = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
      el.toggleAttribute("data-scrolled", scrolled);
      el.toggleAttribute("data-more", more);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    el.addEventListener("scroll", schedule, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    detach.current = () => {
      el.removeEventListener("scroll", schedule);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
