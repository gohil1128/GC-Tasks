import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/brand";
import {
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  codeSchema,
  escapeHtml,
  hashCode as hmacCode,
  newCode,
  tryCode,
  WRONG_CODE_MESSAGE,
  type Defer,
} from "@/modules/auth/email-code";
import { hashPassword, passwordSchema } from "@/modules/auth/password";
import { clearLoginFailures, loginKeys, reserveLoginAttempt } from "@/modules/auth/rate-limit";
import { emailConfigured, sendEmail } from "@/modules/email/send";
import { emailSchema, firstIssue } from "@/modules/team/schemas";

/*
  "Forgot password?": a six-digit code emailed to the account, which sets a
  new password on it. Only offered while email sending is configured.

  The request step answers the same way for every address — real, unknown
  or deactivated — and does the same work in front of the answer: the code
  is made and emailed after the response has gone (the action passes
  Next's after() as `defer`), so neither the reply nor its timing says
  whether an account exists.

  Only an HMAC of the code is stored, bound to the account (see
  ./email-code.ts, shared with sign-up). A code lives ten minutes, survives
  five wrong tries, works once, and asking for a new one kills the old.

  Both steps also go through the sign-in limiter, with keys of their own.
  The limiter gives `ip:` keys the roomier IP limit, so the per-address keys
  start with "ip:" and everything else gets the per-account limit.
*/

export { CODE_MAX_ATTEMPTS, CODE_TTL_MS, WRONG_CODE_MESSAGE };

export const GENERIC_SENT_MESSAGE =
  "If that email has an account, we've sent a 6-digit code to it. It works for 10 minutes.";

export const resetKeys = {
  request: (email: string, ip: string | null) => [
    `reset-req:email:${email}`,
    ...(ip ? [`ip:reset-req:${ip}`] : []),
  ],
  verify: (email: string, ip: string | null) => [
    `reset-verify:email:${email}`,
    ...(ip ? [`ip:reset-verify:${ip}`] : []),
  ],
};

export function passwordResetEnabled(): boolean {
  return emailConfigured();
}

/** Bound to the account, so a code row copied onto another user is useless. */
function hashCode(code: string, userId: string): Buffer {
  return hmacCode("password-reset", userId, code);
}

// ── Step 1: ask for a code ────────────────────────────────────────────────

const requestSchema = z.object({ email: emailSchema });

export type RequestResetResult =
  | { ok: true; email: string }
  | { ok: false; code: "DISABLED" | "INVALID" | "LOCKED"; error: string; retryAfterSec?: number };

export async function requestPasswordReset(
  input: unknown,
  ip: string | null,
  options: { defer?: Defer } = {},
): Promise<RequestResetResult> {
  if (!passwordResetEnabled()) return { ok: false, code: "DISABLED", error: "Password reset by email is off." };

  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID", error: firstIssue(parsed.error) };
  const { email } = parsed.data;

  // Counted whether or not the address is real, so the limit itself says
  // nothing; never cleared, because a request "succeeding" is the thing
  // being rationed (every one can put an email in somebody's inbox).
  const state = await reserveLoginAttempt(resetKeys.request(email, ip));
  if (state.locked) {
    return { ok: false, code: "LOCKED", error: "Too many attempts.", retryAfterSec: state.retryAfterSec };
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } });
  if (user?.active) {
    const work = () => issueAndSend(user.id, email);
    if (options.defer) options.defer(work);
    else await work();
  }
  return { ok: true, email };
}

/** Never throws: it runs after the response, where nobody is left to tell. */
async function issueAndSend(userId: string, email: string): Promise<void> {
  try {
    const code = newCode();
    await prisma.$transaction([
      // One live code per account: a new request retires every earlier one.
      prisma.passwordResetCode.deleteMany({ where: { userId } }),
      prisma.passwordResetCode.create({
        data: {
          userId,
          codeHash: hashCode(code, userId).toString("hex"),
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        },
      }),
    ]);
    await sendEmail(resetEmail(email, code));
  } catch (err) {
    // The code is deliberately not in this message.
    console.error(`Password reset email to ${email} failed`, err);
  }
}

export function resetEmail(to: string, code: string) {
  const minutes = CODE_TTL_MS / 60_000;
  const text = [
    `Your ${APP_SHORT_NAME} password reset code is:`,
    "",
    code,
    "",
    `It expires in ${minutes} minutes. Enter it on the "Forgot password?" page to choose a new password.`,
    "",
    "If you didn't ask for this, ignore this email. Your password stays as it is.",
    "",
    `— ${APP_NAME}`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;color:#2a1d16">
<p>Your ${escapeHtml(APP_SHORT_NAME)} password reset code is:</p>
<p style="font-size:30px;font-weight:600;letter-spacing:6px;margin:16px 0">${code}</p>
<p>It expires in ${minutes} minutes. Enter it on the &ldquo;Forgot password?&rdquo; page to choose a new password.</p>
<p>If you didn&rsquo;t ask for this, ignore this email. Your password stays as it is.</p>
<p style="color:#7a6a60">&mdash; ${escapeHtml(APP_NAME)}</p>
</div>`;
  return { to, subject: `Your ${APP_SHORT_NAME} code: ${code}`, text, html };
}

// ── Step 2: use the code ──────────────────────────────────────────────────

const verifySchema = z
  .object({
    email: emailSchema,
    code: codeSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "The two passwords don't match.",
    path: ["confirmPassword"],
  });

export type ResetResult =
  | { ok: true; email: string }
  | { ok: false; code: "DISABLED" | "INVALID" | "LOCKED" | "WRONG_CODE"; error: string; retryAfterSec?: number };

const wrong = { ok: false, code: "WRONG_CODE", error: WRONG_CODE_MESSAGE } as const;

export async function resetPasswordWithCode(input: unknown, ip: string | null): Promise<ResetResult> {
  if (!passwordResetEnabled()) return { ok: false, code: "DISABLED", error: "Password reset by email is off." };

  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID", error: firstIssue(parsed.error) };
  const { email, code, password } = parsed.data;

  // On top of the per-code count: that one resets with every new code, this
  // one does not, so asking for fresh codes buys no extra guesses.
  const keys = resetKeys.verify(email, ip);
  const state = await reserveLoginAttempt(keys);
  if (state.locked) {
    return { ok: false, code: "LOCKED", error: "Too many attempts.", retryAfterSec: state.retryAfterSec };
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } });
  const row = user?.active
    ? await prisma.passwordResetCode.findFirst({
        where: { userId: user.id, usedAt: null },
        orderBy: { createdAt: "desc" },
      })
    : null;
  if (!user || !row) {
    // The same HMAC a real check costs, so a miss is not obviously quicker.
    hashCode(code, "no-account");
    return wrong;
  }

  // The try is taken before the comparison; see tryCode.
  const now = new Date();
  const right = await tryCode(
    () =>
      prisma.passwordResetCode.updateMany({
        where: { id: row.id, usedAt: null, expiresAt: { gt: now }, attempts: { lt: CODE_MAX_ATTEMPTS } },
        data: { attempts: { increment: 1 } },
      }),
    row.codeHash,
    hashCode(code, user.id),
  );
  if (!right) return wrong;

  const passwordHash = await hashPassword(password);
  const done = await prisma.$transaction(async (tx) => {
    // Claimed here, not above: two right answers at once set one password.
    const claimed = await tx.passwordResetCode.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count === 0) return false;
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // They chose this password themselves, just now.
        mustChangePassword: false,
        // Whoever was signed in as them before is not any more.
        sessionVersion: { increment: 1 },
      },
    });
    return true;
  });
  if (!done) return wrong;

  await clearLoginFailures([...keys, ...loginKeys(email, null)]);
  console.warn(`Password reset by email code: new password set for ${email} (ip ${ip ?? "unknown"})`);
  return { ok: true, email };
}
