import { describe, expect, it } from "vitest";
import { AVATAR_KEYS, AVATAR_LABEL, avatarFor, defaultAvatarForSeed, isAvatarKey } from "@/lib/avatars";
import { profileSchema } from "@/modules/team/schemas";

describe("chai avatar keys", () => {
  it("has five distinct illustrations, each with a name", () => {
    expect(AVATAR_KEYS).toHaveLength(5);
    expect(new Set(AVATAR_KEYS).size).toBe(5);
    for (const key of AVATAR_KEYS) expect(AVATAR_LABEL[key]).toBeTruthy();
  });

  it("accepts only real keys, not the retired animals", () => {
    expect(isAvatarKey("kulhad")).toBe(true);
    expect(isAvatarKey("elaichi")).toBe(true);
    expect(isAvatarKey("fox")).toBe(false);
    expect(isAvatarKey("tiger")).toBe(false);
    expect(isAvatarKey("")).toBe(false);
  });
});

describe("defaultAvatarForSeed", () => {
  it("is stable for the same account", () => {
    expect(defaultAvatarForSeed("user-123")).toBe(defaultAvatarForSeed("user-123"));
  });

  it("always lands on a real illustration", () => {
    for (const seed of ["a", "harsh@example.com", "cm1234567890", "x".repeat(64)]) {
      expect(isAvatarKey(defaultAvatarForSeed(seed))).toBe(true);
    }
  });
});

describe("avatarFor", () => {
  it("prefers a valid pick", () => {
    expect(avatarFor({ id: "u1", avatar: "ketli" })).toBe("ketli");
  });

  it("falls back to the seeded default when unset, invalid, or an old animal", () => {
    expect(avatarFor({ id: "u1", avatar: null })).toBe(defaultAvatarForSeed("u1"));
    expect(avatarFor({ id: "u1", avatar: "dragon" })).toBe(defaultAvatarForSeed("u1"));
    expect(avatarFor({ id: "u1", avatar: "panda" })).toBe(defaultAvatarForSeed("u1"));
    expect(avatarFor({ id: "u1" })).toBe(defaultAvatarForSeed("u1"));
  });
});

describe("profileSchema avatar", () => {
  it("accepts a profile with or without an avatar", () => {
    expect(profileSchema.safeParse({ name: "Asha", color: "teal" }).success).toBe(true);
    expect(profileSchema.safeParse({ name: "Asha", color: "teal", avatar: "patti" }).success).toBe(true);
  });

  it("rejects an avatar that is not in the set", () => {
    expect(profileSchema.safeParse({ name: "Asha", color: "teal", avatar: "owl" }).success).toBe(false);
  });
});
