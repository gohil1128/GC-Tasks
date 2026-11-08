import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, MailConfigError, safeEqual, signState, verifyState } from "@/modules/mail/crypto";

const KEY = randomBytes(32).toString("base64");
let saved: string | undefined;
beforeEach(() => { saved = process.env.MAIL_TOKEN_KEY; process.env.MAIL_TOKEN_KEY = KEY; });
afterEach(() => { if (saved === undefined) delete process.env.MAIL_TOKEN_KEY; else process.env.MAIL_TOKEN_KEY = saved; });

describe("refresh-token encryption", () => {
  it("round-trips", () => {
    expect(decryptSecret(encryptSecret("1//0gRefreshTokenValue"))).toBe("1//0gRefreshTokenValue");
  });

  it("never stores the value in the clear, and differs every time", () => {
    const a = encryptSecret("secret-token");
    const b = encryptSecret("secret-token");
    expect(a).not.toContain("secret-token");
    expect(a).not.toBe(b); // fresh IV
  });

  it("refuses a value that was altered in the table", () => {
    const [v, iv, tag, ct] = encryptSecret("secret-token").split(".");
    const flipped = Buffer.from(ct, "base64url");
    flipped[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64url")].join("."))).toThrow();
  });

  it("cannot be read with a different key", () => {
    const blob = encryptSecret("secret-token");
    process.env.MAIL_TOKEN_KEY = randomBytes(32).toString("base64");
    expect(() => decryptSecret(blob)).toThrow();
  });

  it("fails loudly when the key is missing or the wrong size", () => {
    delete process.env.MAIL_TOKEN_KEY;
    expect(() => encryptSecret("x")).toThrow(MailConfigError);
    process.env.MAIL_TOKEN_KEY = Buffer.from("too short").toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 random bytes/);
  });

  it("rejects something that is not an encrypted value", () => {
    expect(() => decryptSecret("not-a-blob")).toThrow();
  });
});

describe("OAuth state", () => {
  it("verifies a fresh state and carries the user", () => {
    expect(verifyState(signState("user_1"))?.uid).toBe("user_1");
  });

  it("rejects an expired state", () => {
    const t = signState("user_1", 1_000, 1_000_000);
    expect(verifyState(t, 1_000_000 + 999)).not.toBeNull();
    expect(verifyState(t, 1_000_000 + 1_001)).toBeNull();
  });

  it("rejects a forged or tampered state", () => {
    const [body, sig] = signState("user_1").split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "attacker", exp: Date.now() + 1e6, n: "x" })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`)).toBeNull();
    expect(verifyState(`${body}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(verifyState("garbage")).toBeNull();
    expect(verifyState(null)).toBeNull();
    expect(verifyState(undefined)).toBeNull();
  });

  it("is not valid under another key", () => {
    const t = signState("user_1");
    process.env.MAIL_TOKEN_KEY = randomBytes(32).toString("base64");
    expect(verifyState(t)).toBeNull();
  });

  it("gives two different states for the same user", () => {
    expect(signState("u")).not.toBe(signState("u"));
  });
});

describe("safeEqual", () => {
  it("compares by value, whatever the lengths", () => {
    expect(safeEqual("Bearer abc", "Bearer abc")).toBe(true);
    expect(safeEqual("Bearer abc", "Bearer abd")).toBe(false);
    expect(safeEqual("short", "a much longer string than the other")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});
