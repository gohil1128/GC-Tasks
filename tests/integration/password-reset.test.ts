import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  "Forgot password?" by emailed code, against a real Postgres: the same
  answer for every address, one live code per account, the per-code and
  limiter caps, and that a reset signs out old sessions and lifts the
  sign-in lockout.

  The sender is mocked, so nothing here touches the network. The pages are
  called as plain functions to check the link and the 404 follow the email
  configuration.

  Empties every table between tests, so it only runs against a database whose
  URL says it is a test one.
*/

const signals = vi.hoisted(() => {
  class NotFoundSignal extends Error {}
  class RedirectSignal extends Error {
    constructor(public url: string) {
      super(`NEXT_REDIRECT ${url}`);
    }
  }
  return { NotFoundSignal, RedirectSignal };
});

vi.mock("@/modules/email/send", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/email/send")>();
  return { ...original, sendEmail: vi.fn(async () => {}) };
});
// The pages pull in the auth actions; nothing here signs anyone in.
vi.mock("next-auth", () => ({ CredentialsSignin: class extends Error {} }));
vi.mock("@/lib/auth", () => ({ currentUser: async () => null, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new signals.NotFoundSignal();
  },
  redirect: (url: string) => {
    throw new signals.RedirectSignal(url);
  },
}));

import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { colorForSeed } from "@/lib/colors";
import { hashPassword, verifyPassword } from "@/modules/auth/password";
import { EMAIL_MAX, IP_MAX } from "@/modules/auth/rate-limit";
import {
  CODE_MAX_ATTEMPTS,
  passwordResetEnabled,
  requestPasswordReset,
  resetKeys,
  resetPasswordWithCode,
  WRONG_CODE_MESSAGE,
} from "@/modules/auth/password-reset";
import { sendEmail, type OutgoingEmail } from "@/modules/email/send";
import LoginPage from "@/app/(auth)/login/page";
import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";
import VerifyResetCodePage from "@/app/(auth)/forgot-password/verify/page";

const url = process.env.DATABASE_URL ?? "";
const enabled = url.includes("test");

const EMAIL = "staff@example.com";
const OLD_PASSWORD = "forgotten-password-1";
const NEW_PASSWORD = "brand-new-pass-123";
const sent = vi.mocked(sendEmail);

async function reset() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "PasswordResetCode", "Activity", "Comment", "ChecklistItem", "TaskLabel", "TaskAssignee", "Task", "Label", "LoginAttempt", "BoardRevision", "User" RESTART IDENTITY CASCADE`,
  );
  sent.mockReset();
  sent.mockImplementation(async () => {});
}

async function makeUser(over: { email?: string; active?: boolean; mustChangePassword?: boolean } = {}) {
  const email = over.email ?? EMAIL;
  return prisma.user.create({
    data: {
      email,
      name: "Staff",
      role: "STAFF",
      passwordHash: await hashPassword(OLD_PASSWORD),
      color: colorForSeed(email),
      active: over.active ?? true,
      mustChangePassword: over.mustChangePassword ?? false,
    },
  });
}

/** The code out of the n-th email the mock was handed (the last by default). */
function codeFromEmail(n = -1): string {
  const call = sent.mock.calls.at(n);
  if (!call) throw new Error("no email was sent");
  const email = call[0] as OutgoingEmail;
  const match = /\b(\d{6})\b/.exec(email.text);
  if (!match) throw new Error("no code in the email");
  return match[1]!;
}

/** A 6-digit code that is not `code`. */
const otherThan = (code: string) => (code === "000000" ? "111111" : "000000");

const verifyForm = (code: string, over: Partial<Record<"email" | "password" | "confirmPassword", string>> = {}) => ({
  email: EMAIL,
  code,
  password: NEW_PASSWORD,
  confirmPassword: NEW_PASSWORD,
  ...over,
});

/** Every href in a rendered element tree (host elements and props only; components are not run). */
function hrefs(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(hrefs);
  const props = (node as { props?: Record<string, unknown> }).props ?? {};
  const own = typeof props.href === "string" ? [props.href] : [];
  return [...own, ...hrefs(props.children as ReactNode)];
}

function texts(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(texts).join("");
  const props = (node as { props?: Record<string, unknown> }).props ?? {};
  return texts(props.children as ReactNode);
}

async function pageOutcome(run: () => unknown): Promise<"404" | "rendered"> {
  try {
    await run();
    return "rendered";
  } catch (err) {
    if (err instanceof signals.NotFoundSignal) return "404";
    throw err;
  }
}

describe.skipIf(!enabled)("password reset by email (integration)", () => {
  beforeEach(async () => {
    await reset();
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "GC Tasks <tasks@example.com>");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it("emails an active account exactly one 6-digit code, and stores only a hash of it", async () => {
    const user = await makeUser();
    expect(await requestPasswordReset({ email: "  Staff@Example.com " }, "203.0.113.5")).toEqual({
      ok: true,
      email: EMAIL,
    });

    expect(sent).toHaveBeenCalledTimes(1);
    const email = sent.mock.calls[0]![0] as OutgoingEmail;
    const code = codeFromEmail();
    expect(code).toMatch(/^\d{6}$/);
    expect(email.to).toBe(EMAIL);
    expect(email.subject).toBe(`Your GC Tasks code: ${code}`);
    expect(email.text).toContain("10 minutes");
    expect(email.text).toMatch(/didn't ask/i);
    expect(email.html).toContain(code);

    const rows = await prisma.passwordResetCode.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.codeHash).not.toContain(code);
    expect(rows[0]!.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    // Nothing logged carries the code.
    for (const spy of [console.warn, console.error]) {
      for (const args of vi.mocked(spy).mock.calls) expect(JSON.stringify(args)).not.toContain(code);
    }
  });

  it("answers an unknown or deactivated address the same way, without sending anything", async () => {
    await makeUser({ email: "gone@example.com", active: false });

    expect(await requestPasswordReset({ email: "nobody@example.com" }, null)).toEqual({
      ok: true,
      email: "nobody@example.com",
    });
    expect(await requestPasswordReset({ email: "gone@example.com" }, null)).toEqual({
      ok: true,
      email: "gone@example.com",
    });
    expect(sent).not.toHaveBeenCalled();
    expect(await prisma.passwordResetCode.count()).toBe(0);
  });

  it("makes and sends the code in the deferred step, so the answer does not wait on it", async () => {
    await makeUser();
    const deferred: (() => Promise<void>)[] = [];
    const result = await requestPasswordReset({ email: EMAIL }, null, { defer: (work) => void deferred.push(work) });
    expect(result).toEqual({ ok: true, email: EMAIL });
    expect(sent).not.toHaveBeenCalled();
    expect(deferred).toHaveLength(1);
    await deferred[0]!();
    expect(sent).toHaveBeenCalledTimes(1);

    // An unknown address defers nothing; the answer is the same.
    const none: (() => Promise<void>)[] = [];
    expect(await requestPasswordReset({ email: "nobody@example.com" }, null, { defer: (w) => void none.push(w) })).toEqual(
      { ok: true, email: "nobody@example.com" },
    );
    expect(none).toHaveLength(0);
  });

  it("still gives the generic answer when the email cannot be sent, and logs without the code", async () => {
    await makeUser();
    sent.mockRejectedValueOnce(new Error("Resend answered 403: domain not verified"));
    expect(await requestPasswordReset({ email: EMAIL }, null)).toEqual({ ok: true, email: EMAIL });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Password reset email to staff@example.com failed"),
      expect.any(Error),
    );
  });

  it("retires the earlier code when a new one is asked for", async () => {
    await makeUser();
    await requestPasswordReset({ email: EMAIL }, null);
    const first = codeFromEmail(0);
    await requestPasswordReset({ email: EMAIL }, null);
    const second = codeFromEmail(1);
    expect(await prisma.passwordResetCode.count()).toBe(1);

    if (first !== second) {
      expect(await resetPasswordWithCode(verifyForm(first), null)).toMatchObject({ ok: false, code: "WRONG_CODE" });
    }
    expect(await resetPasswordWithCode(verifyForm(second), null)).toEqual({ ok: true, email: EMAIL });
  });

  it("sets the new password, signs out old sessions, clears the lockout and spends the code", async () => {
    const before = await makeUser({ mustChangePassword: true });
    await prisma.loginAttempt.create({
      data: { key: `email:${EMAIL}`, failures: EMAIL_MAX, lockedUntil: new Date(Date.now() + 60 * 60 * 1000) },
    });
    await requestPasswordReset({ email: EMAIL }, "203.0.113.5");
    const code = codeFromEmail();

    expect(await resetPasswordWithCode(verifyForm(` ${code} `, { email: "STAFF@example.com" }), "203.0.113.5")).toEqual({
      ok: true,
      email: EMAIL,
    });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
    expect(await verifyPassword(NEW_PASSWORD, after.passwordHash)).toBe(true);
    expect(after.mustChangePassword).toBe(false);
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    expect(await prisma.loginAttempt.findUnique({ where: { key: `email:${EMAIL}` } })).toBeNull();
    for (const key of resetKeys.verify(EMAIL, "203.0.113.5")) {
      expect(await prisma.loginAttempt.findUnique({ where: { key } })).toBeNull();
    }
    const row = await prisma.passwordResetCode.findFirstOrThrow({ where: { userId: before.id } });
    expect(row.usedAt).not.toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Password reset by email code"));
  });

  it("refuses a used code", async () => {
    await makeUser();
    await requestPasswordReset({ email: EMAIL }, null);
    const code = codeFromEmail();
    expect(await resetPasswordWithCode(verifyForm(code), null)).toMatchObject({ ok: true });
    const again = await resetPasswordWithCode(
      verifyForm(code, { password: "a-third-password-9", confirmPassword: "a-third-password-9" }),
      null,
    );
    expect(again).toEqual({ ok: false, code: "WRONG_CODE", error: WRONG_CODE_MESSAGE });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(await verifyPassword(NEW_PASSWORD, user.passwordHash)).toBe(true);
  });

  it("refuses a wrong code, and the code dies after five wrong tries", async () => {
    const before = await makeUser();
    await requestPasswordReset({ email: EMAIL }, null);
    const code = codeFromEmail();

    for (let i = 0; i < CODE_MAX_ATTEMPTS; i++) {
      expect(await resetPasswordWithCode(verifyForm(otherThan(code)), null)).toEqual({
        ok: false,
        code: "WRONG_CODE",
        error: WRONG_CODE_MESSAGE,
      });
    }
    expect((await prisma.passwordResetCode.findFirstOrThrow()).attempts).toBe(CODE_MAX_ATTEMPTS);

    // Lift the verify limiter, which has also had five tries, to reach the code's own limit.
    await prisma.loginAttempt.deleteMany();
    expect(await resetPasswordWithCode(verifyForm(code), null)).toMatchObject({ ok: false, code: "WRONG_CODE" });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.sessionVersion).toBe(before.sessionVersion);
  });

  it("caps verify attempts per address even across fresh codes", async () => {
    await makeUser();
    for (let i = 0; i < EMAIL_MAX; i++) {
      await requestPasswordReset({ email: EMAIL }, null);
      // Each new code resets its own count; the limiter does not.
      const code = codeFromEmail();
      await prisma.loginAttempt.deleteMany({ where: { key: { startsWith: "reset-req" } } });
      expect(await resetPasswordWithCode(verifyForm(otherThan(code)), `198.51.100.${i}`)).toMatchObject({
        code: "WRONG_CODE",
      });
    }
    await requestPasswordReset({ email: EMAIL }, null);
    const result = await resetPasswordWithCode(verifyForm(codeFromEmail()), "192.0.2.1");
    expect(result).toMatchObject({ ok: false, code: "LOCKED" });
    if (!result.ok) expect(result.retryAfterSec).toBeGreaterThan(0);
  });

  it("refuses an expired code", async () => {
    const before = await makeUser();
    await requestPasswordReset({ email: EMAIL }, null);
    const code = codeFromEmail();
    await prisma.passwordResetCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await resetPasswordWithCode(verifyForm(code), null)).toEqual({
      ok: false,
      code: "WRONG_CODE",
      error: WRONG_CODE_MESSAGE,
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it("does not let a deactivated account use a code it already had", async () => {
    const user = await makeUser();
    await requestPasswordReset({ email: EMAIL }, null);
    const code = codeFromEmail();
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    expect(await resetPasswordWithCode(verifyForm(code), null)).toMatchObject({ ok: false, code: "WRONG_CODE" });
  });

  it("checks the form before spending a try", async () => {
    await makeUser();
    await requestPasswordReset({ email: EMAIL }, null);
    const code = codeFromEmail();
    expect(await resetPasswordWithCode(verifyForm("12345"), null)).toMatchObject({
      code: "INVALID",
      error: "Enter the 6-digit code from the email.",
    });
    expect(await resetPasswordWithCode(verifyForm(code, { password: "short", confirmPassword: "short" }), null)).toMatchObject({
      code: "INVALID",
    });
    expect(await resetPasswordWithCode(verifyForm(code, { confirmPassword: "something-else-1" }), null)).toMatchObject({
      code: "INVALID",
      error: "The two passwords don't match.",
    });
    expect((await prisma.passwordResetCode.findFirstOrThrow()).attempts).toBe(0);
  });

  it("caps code requests per address", async () => {
    await makeUser();
    for (let i = 0; i < EMAIL_MAX; i++) {
      expect(await requestPasswordReset({ email: EMAIL }, `198.51.100.${i}`)).toMatchObject({ ok: true });
    }
    const result = await requestPasswordReset({ email: EMAIL }, "192.0.2.1");
    expect(result).toMatchObject({ ok: false, code: "LOCKED" });
    expect(sent).toHaveBeenCalledTimes(EMAIL_MAX);
    // An unknown address is limited exactly the same, so the limit reveals nothing.
    for (let i = 0; i < EMAIL_MAX; i++) await requestPasswordReset({ email: "nobody@example.com" }, null);
    expect(await requestPasswordReset({ email: "nobody@example.com" }, null)).toMatchObject({ code: "LOCKED" });
  });

  it("caps code requests per network address, with the roomier IP limit", async () => {
    for (let i = 0; i < IP_MAX; i++) {
      expect(await requestPasswordReset({ email: `person${i}@example.com` }, "203.0.113.50")).toMatchObject({
        ok: true,
      });
    }
    expect(await requestPasswordReset({ email: "one-more@example.com" }, "203.0.113.50")).toMatchObject({
      ok: false,
      code: "LOCKED",
    });
    // Someone on another network is unaffected.
    expect(await requestPasswordReset({ email: "one-more@example.com" }, "198.51.100.9")).toMatchObject({ ok: true });
  });

  it("is off, with the link hidden and both pages missing, unless email is configured", async () => {
    await makeUser();
    const login = () => LoginPage({ searchParams: Promise.resolve({}) });

    expect(passwordResetEnabled()).toBe(true);
    expect(hrefs(await login())).toContain("/forgot-password");
    expect(await pageOutcome(() => ForgotPasswordPage())).toBe("rendered");
    expect(await pageOutcome(() => VerifyResetCodePage({ searchParams: Promise.resolve({ email: EMAIL }) }))).toBe(
      "rendered",
    );

    for (const [key, from] of [
      ["", "GC Tasks <tasks@example.com>"],
      ["re_test_key", ""],
    ]) {
      vi.stubEnv("RESEND_API_KEY", key!);
      vi.stubEnv("EMAIL_FROM", from!);
      expect(passwordResetEnabled()).toBe(false);
      const page = await login();
      expect(hrefs(page)).not.toContain("/forgot-password");
      expect(texts(page)).toContain("Ask an owner to reset it for you from the Team page.");
      expect(await pageOutcome(() => ForgotPasswordPage())).toBe("404");
      expect(await pageOutcome(() => VerifyResetCodePage({ searchParams: Promise.resolve({}) }))).toBe("404");
      expect(await requestPasswordReset({ email: EMAIL }, null)).toMatchObject({ ok: false, code: "DISABLED" });
      expect(await resetPasswordWithCode(verifyForm("123456"), null)).toMatchObject({ ok: false, code: "DISABLED" });
    }
    expect(sent).not.toHaveBeenCalled();
  });
});
