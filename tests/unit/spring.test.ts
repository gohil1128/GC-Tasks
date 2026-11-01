import { describe, expect, it } from "vitest";
import {
  CLOSE_SPRING,
  OPEN_SPRING,
  releaseSpring,
  springDurationMs,
  springEasing,
  springProgress,
} from "@/components/ui/spring";
import { journeysPerSecond } from "@/components/ui/zoom-transition";

describe("springProgress", () => {
  it("starts at 0, lands on 1, and never overshoots, however hard it is flicked", () => {
    for (const spring of [OPEN_SPRING, CLOSE_SPRING, releaseSpring(0), releaseSpring(6), releaseSpring(50)]) {
      expect(springProgress(0, spring.omega, spring.velocity)).toBeCloseTo(0, 6);
      let previous = 0;
      for (let ms = 5; ms <= 1200; ms += 5) {
        const p = springProgress(ms / 1000, spring.omega, spring.velocity);
        expect(p).toBeGreaterThanOrEqual(previous - 1e-9);
        expect(p).toBeLessThanOrEqual(1 + 1e-9);
        previous = p;
      }
      expect(previous).toBeGreaterThan(0.999);
    }
  });

  it("covers more ground in the first frames when it starts faster", () => {
    const slow = springProgress(0.03, 22, 0);
    const fast = springProgress(0.03, 22, 20);
    expect(fast).toBeGreaterThan(slow * 3);
  });
});

describe("releaseSpring", () => {
  it("lands sooner after a faster flick", () => {
    const standstill = springDurationMs(releaseSpring(0).omega, releaseSpring(0).velocity);
    const brisk = springDurationMs(releaseSpring(4).omega, releaseSpring(4).velocity);
    const flick = springDurationMs(releaseSpring(12).omega, releaseSpring(12).velocity);
    expect(brisk).toBeLessThan(standstill);
    expect(flick).toBeLessThan(brisk);
    expect(flick).toBeGreaterThan(120);
    expect(standstill).toBeLessThan(450);
  });

  it("starts off briskly even from a standstill, and never past the no-overshoot limit", () => {
    const still = releaseSpring(0);
    expect(still.velocity).toBeGreaterThan(0.4 * still.omega);
    for (const v of [0, 1, 5, 20, 1000, Number.NaN, -3]) {
      const s = releaseSpring(v);
      expect(s.velocity).toBeLessThanOrEqual(s.omega);
      expect(Number.isFinite(s.omega)).toBe(true);
    }
  });
});

describe("springEasing", () => {
  it("falls back to an ordinary ease-out where CSS linear() is unavailable (no CSS here)", () => {
    const { easing, duration } = springEasing(OPEN_SPRING);
    expect(easing).toMatch(/cubic-bezier|linear\(/);
    expect(duration).toBeGreaterThan(150);
    expect(duration).toBeLessThan(600);
  });

  it("draws the spring as a linear() curve from 0 to 1 when the browser can", () => {
    const original = (globalThis as { CSS?: unknown }).CSS;
    (globalThis as { CSS?: unknown }).CSS = { supports: () => true };
    try {
      const { easing } = springEasing(CLOSE_SPRING);
      const stops = /^linear\((.*)\)$/.exec(easing)![1].split(", ").map(Number);
      expect(stops[0]).toBe(0);
      expect(stops.at(-1)).toBe(1);
      expect(stops.length).toBe(41);
      for (let i = 1; i < stops.length; i++) expect(stops[i]).toBeGreaterThanOrEqual(stops[i - 1]);
    } finally {
      (globalThis as { CSS?: unknown }).CSS = original;
    }
  });
});

describe("journeysPerSecond", () => {
  const from = { x: 200, y: 400 };
  const to = { x: 200, y: 100 };

  it("is how many whole trips a second the finger would make over the way still to go", () => {
    // 600 px/s over 300px: two trips a second.
    expect(journeysPerSecond({ vx: 0, vy: -600 }, from, to)).toBeCloseTo(2, 5);
  });

  it("counts the speed in any direction, because a swipe back goes the other way from the card", () => {
    expect(journeysPerSecond({ vx: 900, vy: 0 }, from, to)).toBeCloseTo(3, 5);
    expect(journeysPerSecond({ vx: 0, vy: 600 }, from, to)).toBeCloseTo(2, 5);
    expect(journeysPerSecond({ vx: 300, vy: 400 }, from, to)).toBeCloseTo(500 / 300, 5);
  });

  it("is zero with no release, or when already there", () => {
    expect(journeysPerSecond(undefined, from, to)).toBe(0);
    expect(journeysPerSecond({ vx: 500, vy: 500 }, from, from)).toBe(0);
  });
});
