import { describe, expect, it } from "vitest";
import { carouselSettleMs, columnAfterSwipe, rubberBand } from "@/components/board/use-column-swipe";

describe("columnAfterSwipe", () => {
  it("goes to the next column on a long swipe left, the previous on a swipe right", () => {
    expect(columnAfterSwipe("TODO", -80, 0)).toBe("IN_PROGRESS");
    expect(columnAfterSwipe("IN_PROGRESS", -80, 0)).toBe("DONE");
    expect(columnAfterSwipe("DONE", 80, 0)).toBe("IN_PROGRESS");
    expect(columnAfterSwipe("IN_PROGRESS", 80, 0)).toBe("TODO");
  });

  it("stays put past the first and last column", () => {
    expect(columnAfterSwipe("TODO", 120, 0.8)).toBeNull();
    expect(columnAfterSwipe("DONE", -120, -0.8)).toBeNull();
  });

  it("takes a short quick flick, but not a short slow drag", () => {
    expect(columnAfterSwipe("TODO", -30, -0.6)).toBe("IN_PROGRESS");
    expect(columnAfterSwipe("TODO", -30, -0.1)).toBeNull();
    expect(columnAfterSwipe("TODO", -10, -1)).toBeNull();
  });

  it("cancels when the finger flicks back the other way at the end", () => {
    expect(columnAfterSwipe("TODO", -90, 0.6)).toBeNull();
  });
});

describe("carouselSettleMs", () => {
  it("finishes quicker after a harder flick", () => {
    expect(carouselSettleMs(300, 2.5)).toBeLessThan(carouselSettleMs(300, 0.3));
  });

  it("covers a short distance quicker than a long one at the same speed", () => {
    expect(carouselSettleMs(80, 1)).toBeLessThan(carouselSettleMs(320, 1));
  });

  it("stays within a range that never feels abrupt or sluggish", () => {
    for (const [px, v] of [[0, 5], [390, 0], [390, 0.05], [10, -3], [5_000, 0]] as const) {
      const ms = carouselSettleMs(px, v);
      expect(ms).toBeGreaterThanOrEqual(140);
      expect(ms).toBeLessThanOrEqual(360);
    }
  });
});

describe("rubberBand", () => {
  it("leaves positions between the first and last column alone", () => {
    for (const p of [0, 0.4, 1, 1.5, 2]) expect(rubberBand(p)).toBe(p);
  });

  it("gives only a quarter as far past either end", () => {
    expect(rubberBand(-1)).toBeCloseTo(-0.25);
    expect(rubberBand(3)).toBeCloseTo(2.25);
  });
});
