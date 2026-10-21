import { describe, expect, it } from "vitest";
import { isBackSwipe } from "@/components/ui/swipe-back";

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
