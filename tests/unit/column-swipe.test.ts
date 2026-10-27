import { describe, expect, it } from "vitest";
import { columnAfterSwipe } from "@/components/board/use-column-swipe";

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
