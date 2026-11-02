import { describe, expect, it } from "vitest";
import { REST_BASE, dragFrame, fallbackFrame, restingFrame, zoomFrame } from "@/components/ui/zoom-transition";

const phone = { left: 0, top: 0, width: 390, height: 844 };

function parse(frame: { transform: string; clipPath: string }) {
  const [, tx, ty, s] = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(frame.transform)!.map(Number);
  const [, top, right, bottom, left, round] = /inset\(([\d.]+)px ([\d.]+)px ([\d.]+)px ([\d.]+)px round ([\d.]+)px\)/
    .exec(frame.clipPath)!
    .map(Number);
  return { tx, ty, s, top, right, bottom, left, round };
}

describe("zoomFrame", () => {
  it("lays the sheet exactly over the card: same width, same height, same corners", () => {
    const card = { left: 16, top: 300, width: 358, height: 96 };
    const f = parse(zoomFrame(phone, card, 12));
    expect(f.tx).toBe(16);
    expect(f.ty).toBe(300);
    expect(f.s * phone.width).toBeCloseTo(358, 0);
    // What shows of the sheet, once scaled, is the card's height.
    expect((phone.height - f.bottom) * f.s).toBeCloseTo(96, 0);
    // Corners clipped in the sheet's own (unscaled) units, so they read as 12px on screen.
    expect(f.round * f.s).toBeCloseTo(12, 1);
  });

  it("scales uniformly, never stretching the sheet", () => {
    expect(zoomFrame(phone, { left: 0, top: 0, width: 195, height: 500 }, 0).transform).toMatch(/scale\(0\.5\)$/);
  });

  it("interpolates with the resting frame: same functions, same arity", () => {
    const a = zoomFrame(phone, { left: 10, top: 10, width: 100, height: 40 }, 8);
    const b = restingFrame(0);
    expect(b.transform).toBe("translate(0px, 0px) scale(1)");
    expect(parse(a)).toBeTruthy();
    expect(parse(b)).toEqual({ tx: 0, ty: 0, s: 1, top: 0, right: 0, bottom: 0, left: 0, round: 0 });
  });
});

describe("dragFrame", () => {
  it("is the resting sheet before the finger moves", () => {
    expect(parse(dragFrame(phone, 0, 0)).s).toBe(1);
  });

  it("shrinks and rounds the further it is pulled, but never vanishes", () => {
    const near = parse(dragFrame(phone, 60, 0));
    const far = parse(dragFrame(phone, 300, 0));
    expect(far.s).toBeLessThan(near.s);
    expect(far.round * far.s).toBeGreaterThan(near.round * near.s);
    expect(parse(dragFrame(phone, 5_000, 0)).s).toBeGreaterThanOrEqual(0.68);
  });

  it("follows the finger down as well as across", () => {
    expect(parse(dragFrame(phone, 100, 120)).ty).toBeGreaterThan(parse(dragFrame(phone, 100, 0)).ty);
  });
});

describe("dragFrame from a sheet caught mid-zoom", () => {
  // Grabbed a third of the way through opening: small, low on the screen, clipped to a card.
  const caught = { tx: 40, ty: 300, s: 0.88, clipBottom: 500, radius: 14 };

  it("starts exactly where it was caught, however little the finger has moved", () => {
    const f = parse(dragFrame(phone, 0, 0, caught));
    expect(f.tx).toBeCloseTo(40, 1);
    expect(f.ty).toBeCloseTo(300, 1);
    expect(f.s).toBeCloseTo(0.88, 3);
    expect(f.bottom).toBe(500);
  });

  it("then follows the finger from there, not from where a resting sheet would be", () => {
    const rest = parse(dragFrame(phone, 100, 0));
    const grabbed = parse(dragFrame(phone, 100, 0, caught));
    expect(grabbed.ty).toBeGreaterThan(rest.ty + 250);
    expect(grabbed.s).toBeLessThan(rest.s);
  });

  it("is the same as the plain drag frame when it was at rest", () => {
    expect(dragFrame(phone, 120, 30, REST_BASE)).toEqual(dragFrame(phone, 120, 30));
  });
});

describe("fallbackFrame", () => {
  it("shrinks toward the middle when there is nowhere to fly back to", () => {
    const f = parse(fallbackFrame(phone, 0));
    expect(f.s).toBeLessThan(1);
    expect(f.tx + (phone.width * f.s) / 2).toBeCloseTo(phone.width / 2, 0);
    expect(f.ty + (phone.height * f.s) / 2).toBeCloseTo(phone.height / 2, 0);
  });
});
