import { describe, expect, it } from "vitest";
import {
  MIN_GAP,
  POSITION_STEP,
  hasRoomBetween,
  insertionIndex,
  placeInColumn,
  positionBetween,
  rebalancedPositions,
} from "@/modules/tasks/position";

const col = (...positions: number[]) => positions.map((position, i) => ({ id: `t${i}`, position }));

describe("positionBetween", () => {
  it("starts an empty column at one step", () => {
    expect(positionBetween(null, null)).toBe(POSITION_STEP);
  });

  it("opens a step above the top card and below the bottom card", () => {
    expect(positionBetween(null, 1024)).toBe(0);
    expect(positionBetween(null, -2048)).toBe(-3072);
    expect(positionBetween(2048, null)).toBe(3072);
  });

  it("takes the midpoint between two cards", () => {
    expect(positionBetween(1024, 2048)).toBe(1536);
    expect(positionBetween(-1, 1)).toBe(0);
  });
});

describe("hasRoomBetween", () => {
  it("always has room at the ends", () => {
    expect(hasRoomBetween(null, null)).toBe(true);
    expect(hasRoomBetween(null, 5)).toBe(true);
    expect(hasRoomBetween(5, null)).toBe(true);
  });

  it("runs out after about thirty halvings of a step", () => {
    const above = 0;
    let below = POSITION_STEP;
    let halvings = 0;
    while (hasRoomBetween(above, below)) {
      below = positionBetween(above, below);
      halvings++;
      expect(below).toBeGreaterThan(above);
    }
    expect(halvings).toBe(30); // 1024 / 2^30 < 1e-6
    expect(below - above).toBeLessThan(MIN_GAP);
  });

  it("refuses equal or inverted neighbours", () => {
    expect(hasRoomBetween(3, 3)).toBe(false);
    expect(hasRoomBetween(4, 3)).toBe(false);
  });

  it("refuses a gap a double cannot split, even when it looks wide enough", () => {
    const big = 2 ** 40;
    const next = big + 2 ** -12; // one ulp above `big`, and > MIN_GAP
    expect(next - big).toBeGreaterThan(MIN_GAP);
    expect(hasRoomBetween(big, next)).toBe(false);
  });
});

describe("rebalancedPositions", () => {
  it("spaces cards a step apart from the first step", () => {
    expect(rebalancedPositions(0)).toEqual([]);
    expect(rebalancedPositions(3)).toEqual([1024, 2048, 3072]);
  });
});

describe("insertionIndex", () => {
  const column = col(10, 20, 30); // t0, t1, t2

  it("goes directly below afterId", () => {
    expect(insertionIndex(column, "t0", "t1")).toBe(1);
    expect(insertionIndex(column, "t2", null)).toBe(3);
  });

  it("goes directly above beforeId when there is no afterId", () => {
    expect(insertionIndex(column, null, "t0")).toBe(0);
    expect(insertionIndex(column, null, "t2")).toBe(2);
  });

  it("trusts afterId when the neighbours have been pulled apart", () => {
    expect(insertionIndex(column, "t0", "t2")).toBe(1);
  });

  it("falls back to beforeId when afterId has gone", () => {
    expect(insertionIndex(column, "gone", "t1")).toBe(1);
  });

  it("falls back to the end the browser was aiming at when both have gone", () => {
    expect(insertionIndex(column, "gone", "also-gone")).toBe(3);
    expect(insertionIndex(column, "gone", null)).toBe(3);
    expect(insertionIndex(column, null, "gone")).toBe(0);
    expect(insertionIndex(column, null, null)).toBe(0);
  });

  it("lands at 0 in an empty column whatever it was told", () => {
    expect(insertionIndex([], "x", "y")).toBe(0);
    expect(insertionIndex([], null, null)).toBe(0);
  });
});

describe("placeInColumn", () => {
  it("takes the midpoint when there is room", () => {
    expect(placeInColumn(col(1024, 2048), 1)).toEqual({ position: 1536, rebalance: false });
    expect(placeInColumn(col(1024, 2048), 0)).toEqual({ position: 0, rebalance: false });
    expect(placeInColumn(col(1024, 2048), 2)).toEqual({ position: 3072, rebalance: false });
    expect(placeInColumn([], 0)).toEqual({ position: 1024, rebalance: false });
  });

  it("asks for a rebalance and places against the fresh positions when the gap is used up", () => {
    const tight = col(5, 5 + MIN_GAP / 4, 9);
    const placed = placeInColumn(tight, 1);
    expect(placed.rebalance).toBe(true);
    // Fresh positions are 1024, 2048, 3072; index 1 is between the first two.
    expect(placed.position).toBe(1536);
  });

  it("rebalances when two cards share a position", () => {
    const placed = placeInColumn(col(7, 7), 1);
    expect(placed).toEqual({ position: 1536, rebalance: true });
  });
});
