/*
  The animal chai club: the illustrated avatars a person can pick in
  Settings. Stored by key, never by artwork, so the drawings in
  components/ui/animal-art.tsx can be retouched without a data migration.

  Two crews of five, every animal holding its kulhad: the cute crew smile,
  the wild crew just look like themselves — a calm tiger, a regal lion, a
  jowly bulldog — natural expressions, no cartoon anger.
*/

export const CUTE_ANIMALS = ["fox", "panda", "owl", "cat", "bunny"] as const;
export const WILD_ANIMALS = ["tiger", "lion", "bulldog", "wolf", "monkey"] as const;

export const ANIMAL_KEYS = [...CUTE_ANIMALS, ...WILD_ANIMALS] as const;

export type AnimalKey = (typeof ANIMAL_KEYS)[number];

export function isAnimalKey(value: string): value is AnimalKey {
  return (ANIMAL_KEYS as readonly string[]).includes(value);
}

export const ANIMAL_LABEL: Record<AnimalKey, string> = {
  fox: "Fox",
  panda: "Panda",
  owl: "Owl",
  cat: "Cat",
  bunny: "Bunny",
  tiger: "Tiger",
  lion: "Lion",
  bulldog: "Bulldog",
  wolf: "Wolf",
  monkey: "Monkey",
};

export function isWild(key: AnimalKey): boolean {
  return (WILD_ANIMALS as readonly string[]).includes(key);
}

/**
  A stable animal for an account that has not picked one, hashed from its id
  the same way colours are seeded — the same person lands on the same animal
  on every screen, and two people created together do not both come out fox.
*/
export function defaultAnimalForSeed(seed: string): AnimalKey {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ANIMAL_KEYS[h % ANIMAL_KEYS.length];
}

/** The animal to draw for a person: their pick when valid, else the seeded default. */
export function animalFor(person: { id: string; avatar?: string | null }): AnimalKey {
  return person.avatar && isAnimalKey(person.avatar) ? person.avatar : defaultAnimalForSeed(person.id);
}
