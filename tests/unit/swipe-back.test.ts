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
    animations: [] as Array<{ keyframes: unknown; options: unknown }>,
    getAnimations: () => [],
    animate(keyframes: unknown, options: unknown) {
      this.animations.push({ keyframes, options });
      return { finished: new Promise(() => {}), cancel() {} };
    },
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
    // One frame is 16ms of the fake clock.
    vi.stubGlobal("requestAnimationFrame", (fn: (t: number) => void) => setTimeout(() => fn(0), 16) as unknown as number);
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
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
    vi.advanceTimersByTime(16);
    const scale = Number(/scale\(([\d.]+)\)/.exec(sheet.style.transform)?.[1]);
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThan(0.6);
    expect(sheet.style.clipPath).toMatch(/round/);

    // No slide first: the dialog's zoom close takes it from here.
    sheet.fire("touchend", touchEvent(140, 104));
    expect(sheet.style.animation).toBe("none");
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("draws a zoom drag once a frame, however many touch events arrive", () => {
    const sheet = fakeSheet();
    attachSwipeBack(sheet as unknown as HTMLElement, vi.fn(), undefined, { zoom: true });
    sheet.fire("touchstart", touchEvent(10, 100));
    sheet.fire("touchmove", touchEvent(30, 100));
    sheet.fire("touchmove", touchEvent(60, 101));
    sheet.fire("touchmove", touchEvent(90, 102));
    // Nothing drawn until the frame comes round...
    expect(sheet.style.transform).toBeUndefined();
    vi.advanceTimersByTime(16);
    // ...and then it is the LATEST position that is drawn, not the first.
    const tx = Number(/translate\(([-\d.]+)px/.exec(sheet.style.transform)?.[1]);
    expect(tx).toBeGreaterThan(40);
  });

  it("lets go from where the finger is, even if its last move hasn't been drawn", () => {
    const sheet = fakeSheet();
    const onBack = vi.fn();
    attachSwipeBack(sheet as unknown as HTMLElement, onBack, undefined, { zoom: true });
    sheet.fire("touchstart", touchEvent(10, 100));
    sheet.fire("touchmove", touchEvent(150, 100));
    sheet.fire("touchend", touchEvent(150, 100));
    expect(sheet.style.transform).toMatch(/scale\(0\./);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("a zooming sheet springs back to full size on a short swipe, carrying a leftward release", () => {
    const sheet = fakeSheet();
    const onBack = vi.fn();
    attachSwipeBack(sheet as unknown as HTMLElement, onBack, undefined, { zoom: true });

    sheet.fire("touchstart", touchEvent(10, 100, 1000));
    sheet.fire("touchmove", touchEvent(60, 102, 1050));
    sheet.fire("touchmove", touchEvent(40, 102, 1090));
    sheet.fire("touchend", touchEvent(40, 102, 1100));
    expect(sheet.animations).toHaveLength(1);
    const { keyframes, options } = sheet.animations[0] as {
      keyframes: Array<Record<string, unknown>>;
      options: { duration: number; fill: string };
    };
    expect(keyframes[1].transform).toBe("translate(0px, 0px) scale(1)");
    expect(keyframes[1].opacity).toBe(1);
    expect(options.fill).toBe("forwards");
    expect(options.duration).toBeGreaterThan(100);
    vi.advanceTimersByTime(500);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("a sheet swiped while still opening is picked up where it is, not teleported", () => {
    const sheet = fakeSheet();
    let stopped = 0;
    (sheet as { getAnimations: () => unknown[] }).getAnimations = () => [{ commitStyles() {}, cancel: () => stopped++ }];
    // The styles the frozen animation left: small, low down and clipped to a card.
    sheet.style.clipPath = "inset(0px 0px 520px 0px round 16px)";
    vi.stubGlobal("getComputedStyle", () => ({ transform: "matrix(0.88, 0, 0, 0.88, 40, 300)" }));
    vi.stubGlobal("DOMMatrixReadOnly", class {
      a = 0.88;
      e = 40;
      f = 300;
    });
    attachSwipeBack(sheet as unknown as HTMLElement, vi.fn(), undefined, { zoom: true });
    sheet.fire("touchstart", touchEvent(10, 100));
    sheet.fire("touchmove", touchEvent(30, 100));
    vi.advanceTimersByTime(16);
    expect(stopped).toBeGreaterThan(0);
    // Still down at the card's height and clipped, not snapped to a full-size sheet at the top.
    const ty = Number(/translate\([-\d.]+px, ([-\d.]+)px\)/.exec(sheet.style.transform)?.[1]);
    expect(ty).toBeGreaterThan(250);
    expect(sheet.style.clipPath).toMatch(/520px/);
    vi.unstubAllGlobals();
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
