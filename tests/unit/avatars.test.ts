import { describe, expect, it } from "vitest";
import {
  ANIMAL_KEYS,
  animalFor,
  defaultAnimalForSeed,
  isAnimalKey,
  isWild,
} from "@/lib/avatars";
import { profileSchema } from "@/modules/team/schemas";

describe("animal chai club keys", () => {
  it("has ten animals, five cute and five wild", () => {
    expect(ANIMAL_KEYS).toHaveLength(10);
    expect(ANIMAL_KEYS.filter((k) => isWild(k))).toHaveLength(5);
    expect(new Set(ANIMAL_KEYS).size).toBe(10);
  });

  it("accepts only real keys", () => {
    expect(isAnimalKey("fox")).toBe(true);
    expect(isAnimalKey("wolf")).toBe(true);
    expect(isAnimalKey("bear")).toBe(false);
    expect(isAnimalKey("dragon")).toBe(false);
    expect(isAnimalKey("")).toBe(false);
  });
});

describe("defaultAnimalForSeed", () => {
  it("is stable for the same account", () => {
    expect(defaultAnimalForSeed("user-123")).toBe(defaultAnimalForSeed("user-123"));
  });

  it("always lands on a real animal", () => {
    for (const seed of ["a", "harsh@example.com", "cm1234567890", "x".repeat(64)]) {
      expect(isAnimalKey(defaultAnimalForSeed(seed))).toBe(true);
    }
  });
});

describe("animalFor", () => {
  it("prefers a valid pick", () => {
    expect(animalFor({ id: "u1", avatar: "tiger" })).toBe("tiger");
  });

  it("falls back to the seeded default when unset or invalid", () => {
    expect(animalFor({ id: "u1", avatar: null })).toBe(defaultAnimalForSeed("u1"));
    expect(animalFor({ id: "u1", avatar: "dragon" })).toBe(defaultAnimalForSeed("u1"));
    expect(animalFor({ id: "u1" })).toBe(defaultAnimalForSeed("u1"));
  });
});

describe("profileSchema avatar", () => {
  it("accepts a profile with or without an animal", () => {
    expect(profileSchema.safeParse({ name: "Asha", color: "teal" }).success).toBe(true);
    expect(profileSchema.safeParse({ name: "Asha", color: "teal", avatar: "owl" }).success).toBe(true);
  });

  it("rejects an animal that is not in the club", () => {
    expect(profileSchema.safeParse({ name: "Asha", color: "teal", avatar: "dragon" }).success).toBe(false);
  });
});
