/*
  The chai set: the five minimal illustrations a person can pick as their
  avatar in Settings. Stored by key, never by artwork, so the drawings in
  components/ui/chai-art.tsx can be retouched without a data migration.

  Accounts that picked one of the old animals keep their stored key; it is
  no longer a known one, so they are drawn with their seeded default below
  until they pick again — nobody is ever faceless.
*/

export const AVATAR_KEYS = ["kulhad", "cutting", "ketli", "patti", "elaichi"] as const;

export type AvatarKey = (typeof AVATAR_KEYS)[number];

export function isAvatarKey(value: string): value is AvatarKey {
  return (AVATAR_KEYS as readonly string[]).includes(value);
}

export const AVATAR_LABEL: Record<AvatarKey, string> = {
  kulhad: "Kulhad",
  cutting: "Cutting chai",
  ketli: "Ketli",
  patti: "Chai patti",
  elaichi: "Elaichi",
};

/**
  A stable illustration for an account that has not picked one, hashed from
  its id the same way colours are seeded — the same person lands on the same
  one on every screen, and two people created together rarely match.
*/
export function defaultAvatarForSeed(seed: string): AvatarKey {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_KEYS[h % AVATAR_KEYS.length];
}

/** The illustration to draw for a person: their pick when valid, else the seeded default. */
export function avatarFor(person: { id: string; avatar?: string | null }): AvatarKey {
  return person.avatar && isAvatarKey(person.avatar) ? person.avatar : defaultAvatarForSeed(person.id);
}
