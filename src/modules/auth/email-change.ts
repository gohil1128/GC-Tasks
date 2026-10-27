import { z } from "zod";
import { Prisma } from "@prisma/client";
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
import { verifyPassword } from "@/modules/auth/password";
import { checkLoginAllowed, clearLoginFailures, loginKeys, reserveLoginAttempt } from "@/modules/auth/rate-limit";
import { emailConfigured, sendEmail } from "@/modules/email/send";
import { emailSchema, firstIssue } from "@/modules/team/schemas";
import { emailInUse } from "@/modules/team/service";

/*
  Changing your own email, from Settings. Every change is proved: a
  six-digit code goes to the NEW address, and the account's email (the one
  you sign in with) changes only once that code is typed back. Asking also
  takes your current password, so a phone left signed in is not enough to
  move someone's account to another inbox.

  The code follows the same rules as the other emailed codes (see
  ./email-code.ts): an HMAC bound to the account and the new address, ten
  minutes, five wrong tries, and asking again replaces it. Both steps go
  through the sign-in limiter on keys of their own, and a wrong password
  counts against the account's sign-in lockout, as on Change password.

  Once it changes, the OLD address is told, so a change nobody meant to make
  does not go unnoticed. Sessions stay signed in: currentUser reads the
  email from the database on every request.

  The person is signed in, so saying "that email already has an account" is
  no leak worth hiding — they could find out by trying to sign up.
*/

export { CODE_MAX_ATTEMPTS, CODE_TTL_MS, WRONG_CODE_MESSAGE };

export const EMAIL_TAKEN_MESSAGE = "That email already has an account.";

export const emailChangeKeys = {
  request: (userId: string, ip: string | null) => [
    `email-change-req:user:${userId}`,
    ...(ip ? [`ip:email-change-req:${ip}`] : []),
  ],
  verify: (userId: string, ip: string | null) => [
    `email-change-verify:user:${userId}`,
    ...(ip ? [`ip:email-change-verify:${ip}`] : []),
  ],
};

export function emailChangeEnabled(): boolean {
  return emailConfigured();
}

/** Bound to the account and the address, so a code proves THIS change only. */
function hashCode(code: string, userId: string, newEmail: string): Buffer {
  return hmacCode("email-change", `${userId}:${newEmail}`, code);
}

type Failure<C extends string> = { ok: false; code: C; error: string; retryAfterSec?: number };

// ── Step 1: new address and current password; a code goes to the new one ──

const requestSchema = z.object({
  newEmail: emailSchema,
  password: z.string().min(1, "Enter your current password."),
});

export type RequestEmailChangeResult =
  | { ok: true; newEmail: string }
  | Failure<"DISABLED" | "INVALID" | "LOCKED" | "WRONG_PASSWORD" | "SAME" | "TAKEN" | "SEND_FAILED">;

export async function requestEmailChange(
  userId: string,
  input: unknown,
  ip: string | null,
): Promise<RequestEmailChangeResult> {
  if (!emailChangeEnabled()) {
    return { ok: false, code: "DISABLED", error: "Changing your email needs email sending, which isn't set up yet." };
  }
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID", error: firstIssue(parsed.error) };
  const { newEmail, password } = parsed.data;

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, passwordHash: true } });
  if (!me) return { ok: false, code: "INVALID", error: "Your account couldn't be found. Sign in again." };

  // Every request can put an email in somebody's inbox, so they are rationed
  // and never cleared; the password guess is rationed with sign-in's keys.
  const passwordKeys = loginKeys(me.email, ip);
  const state = await reserveLoginAttempt([...emailChangeKeys.request(userId, ip), ...passwordKeys]);
  if (state.locked) {
    return { ok: false, code: "LOCKED", error: "Too many attempts.", retryAfterSec: state.retryAfterSec };
  }
  if (!(await verifyPassword(password, me.passwordHash))) {
    const after = await checkLoginAllowed(passwordKeys);
    if (after.locked) return { ok: false, code: "LOCKED", error: "Too many attempts.", retryAfterSec: after.retryAfterSec };
    return { ok: false, code: "WRONG_PASSWORD", error: "That isn't your current password." };
  }
  await clearLoginFailures(passwordKeys);

  if (newEmail === me.email.toLowerCase()) {
    return { ok: false, code: "SAME", error: "That's already your email." };
  }
  if (await emailInUse(prisma, newEmail)) return { ok: false, code: "TAKEN", error: EMAIL_TAKEN_MESSAGE };

  const code = newCode();
  await prisma.emailChangeRequest.upsert({
    where: { userId },
    create: {
      userId,
      newEmail,
      codeHash: hashCode(code, userId, newEmail).toString("hex"),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
    update: {
      newEmail,
      codeHash: hashCode(code, userId, newEmail).toString("hex"),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      attempts: 0,
      createdAt: new Date(),
    },
  });

  // Sent before answering: they are waiting for it, and if it bounced they
  // should hear so now rather than wait for a code that is never coming.
  try {
    await sendEmail(codeEmail(newEmail, code));
  } catch (err) {
    console.error(`Email change code to ${newEmail} failed`, err);
    await prisma.emailChangeRequest.deleteMany({ where: { userId } });
    return { ok: false, code: "SEND_FAILED", error: "We couldn't send the code to that address. Check it and try again." };
  }
  return { ok: true, newEmail };
}

export function codeEmail(to: string, code: string) {
  const minutes = CODE_TTL_MS / 60_000;
  const text = [
    `Your ${APP_SHORT_NAME} code to confirm this email address is:`,
    "",
    code,
    "",
    `It expires in ${minutes} minutes. Enter it in Settings to finish changing your email.`,
    "",
    "If you didn't ask for this, ignore this email. Nothing changes unless the code is entered.",
    "",
    `— ${APP_NAME}`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;color:#2a1d16">
<p>Your ${escapeHtml(APP_SHORT_NAME)} code to confirm this email address is:</p>
<p style="font-size:30px;font-weight:600;letter-spacing:6px;margin:16px 0">${code}</p>
<p>It expires in ${minutes} minutes. Enter it in Settings to finish changing your email.</p>
<p>If you didn&rsquo;t ask for this, ignore this email. Nothing changes unless the code is entered.</p>
<p style="color:#7a6a60">&mdash; ${escapeHtml(APP_NAME)}</p>
</div>`;
  return { to, subject: `Your ${APP_SHORT_NAME} code: ${code}`, text, html };
}

function changedEmail(to: string, newEmail: string) {
  const text = [
    `The email on your ${APP_SHORT_NAME} account was changed to ${newEmail}.`,
    `From now on, sign in with ${newEmail}.`,
    "",
    "If you didn't do this, ask an owner on your team to look at your account straight away.",
    "",
    `— ${APP_NAME}`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;color:#2a1d16">
<p>The email on your ${escapeHtml(APP_SHORT_NAME)} account was changed to <strong>${escapeHtml(newEmail)}</strong>.
From now on, sign in with that address.</p>
<p>If you didn&rsquo;t do this, ask an owner on your team to look at your account straight away.</p>
<p style="color:#7a6a60">&mdash; ${escapeHtml(APP_NAME)}</p>
</div>`;
  return { to, subject: `Your ${APP_SHORT_NAME} email was changed`, text, html };
}

// ── Step 2: the code from the new inbox ─────────────────────────────────

const confirmSchema = z.object({ code: codeSchema });

export type ConfirmEmailChangeResult =
  | { ok: true; email: string }
  | Failure<"DISABLED" | "INVALID" | "LOCKED" | "WRONG_CODE" | "NO_REQUEST" | "TAKEN">;

const wrong = { ok: false, code: "WRONG_CODE", error: WRONG_CODE_MESSAGE } as const;

export async function confirmEmailChange(
  userId: string,
  input: unknown,
  ip: string | null,
  options: { defer?: Defer } = {},
): Promise<ConfirmEmailChangeResult> {
  if (!emailChangeEnabled()) {
    return { ok: false, code: "DISABLED", error: "Changing your email needs email sending, which isn't set up yet." };
  }
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID", error: firstIssue(parsed.error) };
  const { code } = parsed.data;

  // On top of the per-code count, which a fresh code resets.
  const keys = emailChangeKeys.verify(userId, ip);
  const state = await reserveLoginAttempt(keys);
  if (state.locked) {
    return { ok: false, code: "LOCKED", error: "Too many attempts.", retryAfterSec: state.retryAfterSec };
  }

  const row = await prisma.emailChangeRequest.findUnique({ where: { userId } });
  if (!row) return { ok: false, code: "NO_REQUEST", error: "Ask for a new code first." };

  // The try is taken before the comparison; see tryCode.
  const now = new Date();
  const right = await tryCode(
    () =>
      prisma.emailChangeRequest.updateMany({
        where: { id: row.id, expiresAt: { gt: now }, attempts: { lt: CODE_MAX_ATTEMPTS } },
        data: { attempts: { increment: 1 } },
      }),
    row.codeHash,
    hashCode(code, userId, row.newEmail),
  );
  if (!right) return wrong;

  let oldEmail: string;
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      // Claimed by deleting it: two right answers at once change it once.
      const claimed = await tx.emailChangeRequest.deleteMany({ where: { id: row.id } });
      if (claimed.count === 0) return "GONE" as const;
      if (await emailInUse(tx, row.newEmail)) return "TAKEN" as const;
      const before = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
      await tx.user.update({ where: { id: userId }, data: { email: row.newEmail } });
      return before.email;
    });
    if (outcome === "GONE") return wrong;
    if (outcome === "TAKEN") return { ok: false, code: "TAKEN", error: EMAIL_TAKEN_MESSAGE };
    oldEmail = outcome;
  } catch (err) {
    // Someone took the address between the check and the write.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, code: "TAKEN", error: EMAIL_TAKEN_MESSAGE };
    }
    throw err;
  }

  await clearLoginFailures(keys);
  console.warn(`Email changed: ${oldEmail} → ${row.newEmail}`);

  const tell = async () => {
    try {
      await sendEmail(changedEmail(oldEmail, row.newEmail));
    } catch (err) {
      console.error(`Email-changed notice to ${oldEmail} failed`, err);
    }
  };
  if (options.defer) options.defer(tell);
  else await tell();

  return { ok: true, email: row.newEmail };
}

/** Drops a pending change, if there is one (the form's "Use a different email"). */
export async function cancelEmailChange(userId: string): Promise<void> {
  await prisma.emailChangeRequest.deleteMany({ where: { userId } });
}
