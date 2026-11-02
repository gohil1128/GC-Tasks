/*
  A critically damped spring, for motion that has to carry on from how fast
  a finger was moving when it let go.

  The sheet's whole journey (from where it is to where it is going) is one
  number, progress `p`, from 0 to 1. The spring moves p, and the frames are
  drawn from it, so a quick flick starts the sheet off quickly and finishes
  sooner, and a slow release starts gently and takes longer: the same curve,
  never a fixed time. Critically damped means it never overshoots, however
  hard it is flicked: the sheet lands on its card once and stays there.

  With e = 1 - p the distance still to go:  e(t) = (1 + (w - v) t) e^(-w t)
  where w (omega) is the stiffness, v the starting speed in journeys per
  second. v can't be allowed past w, or e would cross zero and overshoot.
*/

/** Progress 0..1 at `seconds` for a spring of stiffness `omega` that starts at `velocity` journeys/second. */
export function springProgress(seconds: number, omega: number, velocity: number): number {
  const v = Math.min(velocity, omega);
  const t = Math.max(seconds, 0);
  return 1 - (1 + (omega - v) * t) * Math.exp(-omega * t);
}

/** Within this much of the end, the journey counts as finished. */
const SETTLED = 0.004;

/** Milliseconds until the spring is within 0.4% of the end. */
export function springDurationMs(omega: number, velocity: number): number {
  for (let ms = 10; ms < 1500; ms += 5) {
    if (1 - springProgress(ms / 1000, omega, velocity) <= SETTLED) return ms;
  }
  return 1500;
}

export type SpringKind = { omega: number; velocity: number };

/*
  How the sheet's own taps move: a strong ease-out. It starts at about two
  thirds of the spring's top speed, so the first frames already show movement
  (a tap should feel heard) without leaping, and the rest is a long, soft landing.
*/
export const OPEN_SPRING: SpringKind = { omega: 22, velocity: 22 * 0.65 };
export const CLOSE_SPRING: SpringKind = { omega: 27, velocity: 27 * 0.65 };

/**
  The spring for a finger that let go moving at `journeysPerSecond` (how many
  whole trips to the destination it would make in a second, at that speed).
  Faster flicks are stiffer, so they land sooner; a release from a standstill
  still starts briskly, because a stopped sheet that crawls feels stuck.
*/
export function releaseSpring(journeysPerSecond: number): SpringKind {
  const measured = Math.max(0, Number.isFinite(journeysPerSecond) ? journeysPerSecond : 0);
  const omega = Math.min(36, 22 + 2.2 * measured);
  const velocity = Math.min(Math.max(measured, 0.45 * omega), 0.97 * omega);
  return { omega, velocity };
}

/** Whether the browser can draw an arbitrary curve as an animation's easing (CSS `linear()`). */
export function supportsLinearEasing(): boolean {
  return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("animation-timing-function", "linear(0, 1)");
}

/** The spring as a CSS `linear()` easing over its own duration, and how long that is. */
export function springEasing(spring: SpringKind): { easing: string; duration: number } {
  const duration = springDurationMs(spring.omega, spring.velocity);
  if (!supportsLinearEasing()) {
    // An ordinary strong ease-out over the same time: the same shape, without the per-finger speed.
    return { easing: "cubic-bezier(0.22, 1, 0.36, 1)", duration };
  }
  const steps = 40;
  const stops: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const p = i === steps ? 1 : springProgress((duration / 1000) * (i / steps), spring.omega, spring.velocity);
    stops.push(String(Math.round(p * 10_000) / 10_000));
  }
  return { easing: `linear(${stops.join(", ")})`, duration };
}
