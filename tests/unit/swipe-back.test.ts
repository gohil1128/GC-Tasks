import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachSwipeBack, BACK_FLICK_VELOCITY, isBackSwipe, slideOffMs } from "@/components/ui/swipe-back";

describe("isBackSwipe", () => {
  it("closes on a drag past the threshold, at any speed", () => {
    expect(isBackSwipe(80, 0)).toBe(true);
    expect(isBackSwipe(200, 0.1)).toBe(true);
  });

  it("closes on a quick flick, however short", () => {
    expect(isBackSwipe(30, 0.5)).toBe(true);
    expect(isBackSwipe(24, BACK_FLICK_VELOCITY)).toBe(true);
  });

  it("springs back on a short slow drag or a tiny twitch", () => {
    expect(isBackSwipe(79, 0)).toBe(false);
    expect(isBackSwipe(60, 0.2)).toBe(false);
    expect(isBackSwipe(10, 2)).toBe(false);
  });

  it("cancels when flicked back to the left, even after a long drag", () => {
    expect(isBackSwipe(150, -0.5)).toBe(false);
  });
});

describe("slideOffMs", () => {
  it("is quicker after a quicker flick, within 120–200ms", () => {
    expect(slideOffMs(400, 0)).toBe(200);
    expect(slideOffMs(300, 2.5)).toBe(120);
    expect(slideOffMs(300, 2)).toBeLessThan(slideOffMs(300, 0));
  });
});

/*
  The Oct 22 regression: the gesture's listeners were registered once at
  page load, when the sheet element did not exist yet, so the swipe never
  armed. attachSwipeBack is the piece that runs when the sheet mounts —
  these tests drive it with a fake sheet and synthetic touch events.
*/
type Handler = (event: never) => void;

function fakeSheet(clientWidth = 360, clientHeight = 640) {
  const handlers = new Map<string, Set<Handler>>();
  return {
    clientWidth,
    clientHeight,
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

function touchEvent(x: number, y: number, timeStamp = 0) {
  return {
    timeStamp,
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
    vi.advanceTimersByTime(200);
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

  it("closes on a short quick flick", () => {
    const sheet = fakeSheet();
    const onBack = vi.fn();
    attachSwipeBack(sheet as unknown as HTMLElement, onBack);

    sheet.fire("touchstart", touchEvent(10, 100, 1000));
    sheet.fire("touchmove", touchEvent(25, 101, 1016));
    sheet.fire("touchmove", touchEvent(45, 103, 1032));
    sheet.fire("touchend", touchEvent(45, 103, 1040));
    vi.advanceTimersByTime(200);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("still closes when the thumb arcs up or down on the way", () => {
    // The old rule refused any drag that drifted more than 56px vertically,
    // which is most real thumb swipes: the sheet slid, then snapped back.
    const sheet = fakeSheet();
    const onBack = vi.fn();
    attachSwipeBack(sheet as unknown as HTMLElement, onBack);

    sheet.fire("touchstart", touchEvent(10, 300));
    sheet.fire("touchmove", touchEvent(40, 295));
    sheet.fire("touchmove", touchEvent(150, 210));
    sheet.fire("touchend", touchEvent(150, 210));
    vi.advanceTimersByTime(200);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("cancels when flicked back left at the end", () => {
    const sheet = fakeSheet();
    const onBack = vi.fn();
    attachSwipeBack(sheet as unknown as HTMLElement, onBack);

    sheet.fire("touchstart", touchEvent(10, 100, 1000));
    sheet.fire("touchmove", touchEvent(180, 100, 1200));
    sheet.fire("touchmove", touchEvent(150, 100, 1250));
    sheet.fire("touchmove", touchEvent(110, 100, 1280));
    sheet.fire("touchend", touchEvent(110, 100, 1290));
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
    vi.advanceTimersByTime(200);
    expect(sheet.style.animation).toBe("none");
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("a zooming sheet shrinks into a card under the finger and hands over straight away", () => {
    const sheet = fakeSheet();
    const onBack = vi.fn();
    attachSwipeBack(sheet as unknown as HTMLElement, onBack, undefined, { zoom: true });

    sheet.fire("touchstart", touchEvent(10, 100));
    sheet.fire("touchmove", touchEvent(140, 104));
    const scale = Number(/scale\(([\d.]+)\)/.exec(sheet.style.transform)?.[1]);
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThan(0.6);
    expect(sheet.style.clipPath).toMatch(/round/);

    // No slide first: the dialog's zoom close takes it from here.
    sheet.fire("touchend", touchEvent(140, 104));
    expect(sheet.style.animation).toBe("none");
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("a zooming sheet springs back to full size on a short swipe", () => {
    const sheet = fakeSheet();
    const onBack = vi.fn();
    attachSwipeBack(sheet as unknown as HTMLElement, onBack, undefined, { zoom: true });

    sheet.fire("touchstart", touchEvent(10, 100));
    sheet.fire("touchmove", touchEvent(50, 102));
    sheet.fire("touchend", touchEvent(50, 102));
    expect(sheet.style.transform).toBe("translate(0px, 0px) scale(1)");
    vi.advanceTimersByTime(500);
    expect(onBack).not.toHaveBeenCalled();
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
