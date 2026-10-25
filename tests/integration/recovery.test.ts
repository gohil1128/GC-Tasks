import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { colorForSeed } from "@/lib/colors";
import { hashPassword, verifyPassword } from "@/modules/auth/password";
import { EMAIL_MAX } from "@/modules/auth/rate-limit";
import { recoverAccount, recoveryEnabled } from "@/modules/auth/recovery";

/*
  Account recovery against a real Postgres: the key gate, the lockout it
  shares with sign-in, and that a recovery leaves the account's data alone
  and signs out its old sessions.

  Empties every table between tests, so it only runs against a database whose
  URL says it is a test one.
*/

const url = process.env.DATABASE_URL ?? "";
const enabled = url.includes("test");

const KEY = "a-long-recovery-key-for-the-tests-0123456789";
const NEW_PASSWORD = "brand-new-pass-123";

async function reset() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Activity", "Comment", "ChecklistItem", "TaskLabel", "TaskAssignee", "Task", "Label", "LoginAttempt", "BoardRevision", "User" RESTART IDENTITY CASCADE`,
  );
}

async function makeOwner(over: { active?: boolean; mustChangePassword?: boolean } = {}) {
  return prisma.user.create({
    data: {
      email: "owner@example.com",
      name: "Owner",
      role: "OWNER",
      passwordHash: await hashPassword("forgotten-password-1"),
      color: colorForSeed("owner@example.com"),
      active: over.active ?? true,
      mustChangePassword: over.mustChangePassword ?? false,
    },
  });
}

const form = (over: Partial<Record<"key" | "email" | "password" | "confirmPassword", string>> = {}) => ({
  key: KEY,
  email: "owner@example.com",
  password: NEW_PASSWORD,
  confirmPassword: NEW_PASSWORD,
  ...over,
});

describe.skipIf(!enabled)("account recovery (integration)", () => {
  beforeEach(async () => {
    await reset();
    vi.stubEnv("RECOVERY_KEY", KEY);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it("is off unless a long enough RECOVERY_KEY is set", async () => {
    vi.stubEnv("RECOVERY_KEY", "");
    expect(recoveryEnabled()).toBe(false);
    expect(await recoverAccount(form({ key: "" }), null)).toMatchObject({ ok: false, code: "DISABLED" });
    vi.stubEnv("RECOVERY_KEY", "short-key");
    expect(recoveryEnabled()).toBe(false);
    vi.stubEnv("RECOVERY_KEY", KEY);
    expect(recoveryEnabled()).toBe(true);
  });

  it("sets a new password on the account, keeps its data, and signs out old sessions", async () => {
    const before = await makeOwner({ active: false, mustChangePassword: true });
    const task = await prisma.task.create({
      data: { title: "Still mine", position: 1, createdById: before.id, updatedById: before.id },
    });

    expect(await recoverAccount(form({ email: "  Owner@Example.com " }), "203.0.113.5")).toEqual({
      ok: true,
      email: "owner@example.com",
    });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
    expect(await verifyPassword(NEW_PASSWORD, after.passwordHash)).toBe(true);
    expect(after).toMatchObject({ active: true, mustChangePassword: false, role: "OWNER", name: "Owner" });
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toMatchObject({ createdById: before.id });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Account recovery used"));
  });

  it("refuses a wrong key and changes nothing", async () => {
    const before = await makeOwner();
    expect(await recoverAccount(form({ key: "not-the-key" }), null)).toMatchObject({ ok: false, code: "WRONG_KEY" });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.sessionVersion).toBe(before.sessionVersion);
  });

  it("locks out key guessing from every address together, not just one", async () => {
    await makeOwner();
    for (let i = 0; i < EMAIL_MAX; i++) {
      const result = await recoverAccount(form({ key: `guess-${i}` }), `198.51.100.${i}`);
      expect(result).toMatchObject({ ok: false, code: "WRONG_KEY" });
    }
    // Even the right key waits out the lock, from a fresh address.
    expect(await recoverAccount(form(), "192.0.2.77")).toMatchObject({ ok: false, code: "LOCKED" });
  });

  it("says so when no account has that email", async () => {
    await makeOwner();
    expect(await recoverAccount(form({ email: "nobody@example.com" }), null)).toMatchObject({
      ok: false,
      code: "NO_ACCOUNT",
    });
  });

  it("checks the new password like any other", async () => {
    await makeOwner();
    expect(await recoverAccount(form({ password: "short", confirmPassword: "short" }), null)).toMatchObject({
      ok: false,
      code: "INVALID",
    });
    expect(await recoverAccount(form({ confirmPassword: "something-else-1" }), null)).toMatchObject({
      ok: false,
      code: "INVALID",
      error: "The two passwords don't match.",
    });
  });

  it("clears the account's sign-in lockout, so the new password works straight away", async () => {
    await makeOwner();
    await prisma.loginAttempt.create({
      data: { key: "email:owner@example.com", failures: EMAIL_MAX, lockedUntil: new Date(Date.now() + 60 * 60 * 1000) },
    });
    expect(await recoverAccount(form(), null)).toMatchObject({ ok: true });
    expect(await prisma.loginAttempt.findUnique({ where: { key: "email:owner@example.com" } })).toBeNull();
  });
});
