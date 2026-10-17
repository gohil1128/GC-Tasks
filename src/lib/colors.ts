/*
  The tints a label or an avatar can take. Stored by key, never by value, so
  the palette can be retuned (or given a dark-mode variant) without a data
  migration. Each pairs a soft background with an ink dark enough to read on
  it (4.5:1 or better in light mode); dark mode overrides live in globals.css
  under the same class names.
*/
export const COLOR_KEYS = [
  "rust",
  "espresso",
  "amber",
  "olive",
  "green",
  "teal",
  "blue",
  "indigo",
  "plum",
  "rose",
  "slate",
] as const;

export type ColorKey = (typeof COLOR_KEYS)[number];

export function isColorKey(value: string): value is ColorKey {
  return (COLOR_KEYS as readonly string[]).includes(value);
}

/** Class names for a chip in this colour: `tint-<key>` sets background and text. */
export function tintClass(key: string): string {
  return `tint-${isColorKey(key) ? key : "slate"}`;
}

/** Class names for a solid swatch / avatar fill in this colour. */
export function solidClass(key: string): string {
  return `solid-${isColorKey(key) ? key : "slate"}`;
}

/**
  A stable colour for a new account, picked from its email so two people
  created together do not both come out rust.
*/
export function colorForSeed(seed: string): ColorKey {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COLOR_KEYS[h % COLOR_KEYS.length];
}
