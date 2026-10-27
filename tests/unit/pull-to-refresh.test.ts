import { describe, expect, it } from "vitest";
import { pullDistance, shouldRefresh } from "@/components/shell/pull-to-refresh";

describe("pullDistance", () => {
  it("is zero for no pull and never negative", () => {
    expect(pullDistance(0)).toBe(0);
    expect(pullDistance(-50)).toBe(0);
  });

  it("follows the finger with resistance, never more than the finger travelled", () => {
    for (const dy of [20, 60, 120, 200]) {
      expect(pullDistance(dy)).toBeGreaterThan(0);
      expect(pullDistance(dy)).toBeLessThan(dy);
    }
  });

  it("grows with the pull but is capped, so it can't be dragged off screen", () => {
    let last = 0;
    for (const dy of [10, 50, 100, 200, 400, 1_000, 5_000, 50_000]) {
      const d = pullDistance(dy);
      expect(d).toBeGreaterThanOrEqual(last);
      expect(d).toBeLessThanOrEqual(110);
      last = d;
    }
  });
});

describe("shouldRefresh", () => {
  it("needs a deliberate pull, not a nudge", () => {
    expect(shouldRefresh(pullDistance(40))).toBe(false);
    expect(shouldRefresh(pullDistance(240))).toBe(true);
  });
});
