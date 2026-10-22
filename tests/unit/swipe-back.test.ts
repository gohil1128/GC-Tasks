import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachSwipeBack, isBackSwipe } from "@/components/ui/swipe-back";

describe("isBackSwipe", () => {
  it("accepts a clean rightward swipe", () => {
    expect(isBackSwipe(120, 0)).toBe(true);
    expect(isBackSwipe(80, 10)).toBe(true);
    expect(isBackSwipe(200, -40)).toBe(true);
  });

  it("rejects short or leftward movement", () => {
    expect(isBackSwipe(79, 0)).toBe(false);
    expect(isBackSwipe(-120, 0)).toBe(false);
    expect(isBackSwipe(0, 0)).toBe(false);
  });

  it("rejects vertical scrolling and diagonals", () => {
    expect(isBackSwipe(120, 57)).toBe(false);
    expect(isBackSwipe(120, 100)).toBe(false);
    expect(isBackSwipe(90, 70)).toBe(false);
    expect(isBackSwipe(10, 200)).toBe(false);
  });
});

/*
  The Oct 22 regression: the gesture's listeners were registered once at
  page load, when the sheet element did not exist yet, so the swipe never
  armed. attachSwipeBack is the piece that runs when the sheet mounts —
  these tests drive it with a fake sheet and synthetic touch events.
*/
type Handler = (event: never) => void;

function fakeSheet(clientWidth = 360) {
  const handlers = new Map<string, Set<Handler>>();
  return {
    clientWidth,
    style: {} as Record<string, string>,
    addEventListener(type: string, fn: Handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: Handler) {
      handlers.get(type)?.delete(fn);
    },
    fire(type: string, event: unknown) {
      handlers.get(type)?.forEach((fn) => fn(event as never));
    },
    listenerCount(type: string) {
      return handlers.get(type)?.size ?? 0;
    },
  };
}

function touchEvent(x: number, y: number) {
  return {
    touches: [{ clientX: x, clientY: y }],
    changedTouches: [{ clientX: x, clientY: y }],
    preventDefault() {},
  };
}

describe("attachSwipeBack", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("follows the finger and closes on release past the threshold", () => {
    const sheet = fakeSheet();
    const onBack = vi.fn();
    attachSwipeBack(sheet as unknown as HTMLElement, onBack);

    sheet.fire("touchstart", touchEvent(10, 100));
    sheet.fire("touchmove", touchEvent(140, 104));
    expect(sheet.style.transform).toBe("translateX(130px)");

    sheet.fire("touchend", touchEvent(140, 104));
    expect(onBack).not.toHaveBeenCalled();
    vi.advanceTimersByTime(190);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("springs back instead of closing on a short swipe", () => {
    const sheet = fakeSheet();
    const onBack = vi.fn();
    attachSwipeBack(sheet as unknown as HTMLElement, onBack);

    sheet.fire("touchstart", touchEvent(10, 100));
    sheet.fire("touchmove", touchEvent(50, 102));
    sheet.fire("touchend", touchEvent(50, 102));
    expect(sheet.style.transform).toBe("translateX(0px)");
    vi.advanceTimersByTime(500);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("never takes over a vertical scroll", () => {
    const sheet = fakeSheet();
    const onBack = vi.fn();
    attachSwipeBack(sheet as unknown as HTMLElement, onBack);

    sheet.fire("touchstart", touchEvent(100, 10));
    sheet.fire("touchmove", touchEvent(104, 190));
    expect(sheet.style.transform).toBeUndefined();
    sheet.fire("touchend", touchEvent(104, 190));
    vi.advanceTimersByTime(500);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("switches the exit animation off before handing over the close", () => {
    // Regression (Oct 22): the dialog's CSS exit animation outranks the
    // inline slide transform, so without this the sheet snapped back to
    // the middle to fade out — it looked like it went back twice.
    const sheet = fakeSheet();
    const onBack = vi.fn();
    attachSwipeBack(sheet as unknown as HTMLElement, onBack);

    sheet.fire("touchstart", touchEvent(10, 100));
    sheet.fire("touchmove", touchEvent(140, 104));
    sheet.fire("touchend", touchEvent(140, 104));
    vi.advanceTimersByTime(190);
    expect(sheet.style.animation).toBe("none");
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("springs back when the close is refused", () => {
    const sheet = fakeSheet();
    const onBack = vi.fn();
    attachSwipeBack(sheet as unknown as HTMLElement, onBack, () => false);

    sheet.fire("touchstart", touchEvent(10, 100));
    sheet.fire("touchmove", touchEvent(140, 104));
    sheet.fire("touchend", touchEvent(140, 104));
    expect(sheet.style.transform).toBe("translateX(0px)");
    vi.advanceTimersByTime(500);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("detach removes every listener", () => {
    const sheet = fakeSheet();
    const detach = attachSwipeBack(sheet as unknown as HTMLElement, vi.fn());
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
      expect(sheet.listenerCount(type)).toBe(1);
    }
    detach();
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
      expect(sheet.listenerCount(type)).toBe(0);
    }
  });
});
