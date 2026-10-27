import { describe, expect, it } from "vitest";
import { columnAfterSwipe, settleDurations } from "@/components/board/use-column-swipe";

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

describe("settleDurations", () => {
  it("finishes quicker after a harder flick", () => {
    const slow = settleDurations(140, 0.3);
    const fast = settleDurations(140, 2.5);
    expect(fast.out).toBeLessThan(slow.out);
    expect(fast.in).toBeLessThanOrEqual(slow.in);
  });

  it("covers a short distance quicker than a long one at the same speed", () => {
    expect(settleDurations(60, 1).out).toBeLessThan(settleDurations(160, 1).out);
  });

  it("stays within a range that never feels abrupt or sluggish", () => {
    for (const [px, v] of [[0, 5], [400, 0], [400, 0.05], [10, -3]] as const) {
      const t = settleDurations(px, v);
      expect(t.out).toBeGreaterThanOrEqual(70);
      expect(t.out).toBeLessThanOrEqual(220);
      expect(t.in).toBeGreaterThanOrEqual(150);
      expect(t.in).toBeLessThanOrEqual(280);
    }
  });
});
