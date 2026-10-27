import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/brand";
import { colorForSeed } from "@/lib/colors";
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
import { clearLoginFailures, reserveLoginAttempt } from "@/modules/auth/rate-limit";
import { emailConfigured, sendEmail } from "@/modules/email/send";
import { scheduleTeamPush } from "@/modules/notifications/dispatch";
import { emailSchema, firstIssue, nameSchema } from "@/modules/team/schemas";
import { bumpRevision, emailInUse, lockTeam, readSignupsOpen } from "@/modules/team/service";

/*
  "Create an account": anyone can join the board as Staff by proving they
  own an email address. Offered only while email sending is configured AND
  an owner has sign-ups open (the switch on the Team page); otherwise the
  link is hidden and both pages are a 404.

  Step one takes a name, an email and a password, and answers the same way
  for every address — "we've sent a code" — so the page never says who
  already has an account. Behind that answer, after the response has gone
  (the action passes Next's after() as `defer`, as password reset does):
    - a new address gets a pending SignupRequest (the bcrypt hash of the
      chosen password, an HMAC of a 6-digit code) and the code by email;
    - an address that already has an account, active or not, gets nothing
      stored and a short note saying so instead.
  Both kinds of work happen after the response, so the timing says nothing
  either.

  Step two takes the email and the code. The code follows the same rules
  as a reset code (./email-code.ts): ten minutes, five wrong tries, one
  use. On success the account is made under the team lock — re-checking
  the switch and that nobody took the address meanwhile — the owners are
  told, and the action signs the person in.

  Both steps go through the sign-in limiter with keys of their own; `ip:`
  keys get the roomier per-network limit.
*/

export const signupKeys = {
  request: (email: string, ip: string | null) => [
    `signup-req:email:${email}`,
    ...(ip ? [`ip:signup-req:${ip}`] : []),
  ],
  verify: (email: string, ip: string | null) => [
    `signup-verify:email:${email}`,
    ...(ip ? [`ip:signup-verify:${ip}`] : []),
  ],
};

export function signupSentMessage(email: string): string {
  return `We've sent a 6-digit code to ${email}. It works for ${CODE_TTL_MS / 60_000} minutes.`;
}

export const EMAIL_TAKEN_MESSAGE = "That email already has an account. Sign in instead, or use Forgot password.";
const DISABLED = { ok: false, code: "DISABLED", error: "Sign-up is closed." } as const;

/** Whether the sign-in page offers sign-up and /signup exists. */
export async function signupsAvailable(): Promise<boolean> {
  return emailConfigured() && (await readSignupsOpen());
}

/** Bound to the address, so a code row copied onto another one is useless. */
function hashCode(code: string, email: string): Buffer {
  return hmacCode("signup", email, code);
}

// ── Step 1: ask for a code ────────────────────────────────────────────────

const requestSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "The two passwords don't match.",
    path: ["confirmPassword"],
  });

export type RequestSignupResult =
  | { ok: true; email: string }
  | { ok: false; code: "DISABLED" | "INVALID" | "LOCKED"; error: string; retryAfterSec?: number };

export async function requestSignup(
  input: unknown,
  ip: string | null,
  options: { defer?: Defer } = {},
): Promise<RequestSignupResult> {
  if (!(await signupsAvailable())) return DISABLED;

  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID", error: firstIssue(parsed.error) };
  const { name, email, password } = parsed.data;

  // Counted whatever the address, and never cleared: every request can put
  // an email in somebody's inbox, which is the thing being rationed.
  const state = await reserveLoginAttempt(signupKeys.request(email, ip));
  if (state.locked) {
    return { ok: false, code: "LOCKED", error: "Too many attempts.", retryAfterSec: state.retryAfterSec };
  }

  // Even whether the address is taken is looked up after the response.
  const work = () => issueAndSend(name, email, password);
  if (options.defer) options.defer(work);
  else await work();
  return { ok: true, email };
}

/** Never throws: it runs after the response, where nobody is left to tell. */
async function issueAndSend(name: string, email: string, password: string): Promise<void> {
  try {
    if (await emailInUse(prisma, email)) {
      // Nothing to wait for: a stale request for this address can go.
      await prisma.signupRequest.deleteMany({ where: { email } });
      await sendEmail(alreadyRegisteredEmail(email));
      return;
    }
    const code = newCode();
    const passwordHash = await hashPassword(password);
    const fields = {
      name,
      passwordHash,
      codeHash: hashCode(code, email).toString("hex"),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      attempts: 0,
      createdAt: new Date(),
    };
    await prisma.$transaction([
      // Housekeeping: requests nobody came back for.
      prisma.signupRequest.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
      // One pending sign-up per address: asking again replaces the old one, code and all.
      prisma.signupRequest.upsert({ where: { email }, create: { email, ...fields }, update: fields }),
    ]);
    await sendEmail(signupEmail(email, code));
  } catch (err) {
    // The code is deliberately not in this message.
    console.error(`Sign-up email to ${email} failed`, err);
  }
}

export function signupEmail(to: string, code: string) {
  const minutes = CODE_TTL_MS / 60_000;
  const text = [
    `Your ${APP_SHORT_NAME} sign-up code is:`,
    "",
    code,
    "",
    `It expires in ${minutes} minutes. Enter it on the sign-up page to finish creating your account.`,
    "",
    "If you didn't try to create an account, ignore this email. Nothing is created without the code.",
    "",
    `— ${APP_NAME}`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;color:#2a1d16">
<p>Your ${escapeHtml(APP_SHORT_NAME)} sign-up code is:</p>
<p style="font-size:30px;font-weight:600;letter-spacing:6px;margin:16px 0">${code}</p>
<p>It expires in ${minutes} minutes. Enter it on the sign-up page to finish creating your account.</p>
<p>If you didn&rsquo;t try to create an account, ignore this email. Nothing is created without the code.</p>
<p style="color:#7a6a60">&mdash; ${escapeHtml(APP_NAME)}</p>
</div>`;
  return { to, subject: `Your ${APP_SHORT_NAME} code: ${code}`, text, html };
}

export function alreadyRegisteredEmail(to: string) {
  const text = [
    `Someone tried to create a ${APP_SHORT_NAME} account with this email. You already have one: sign in, or use Forgot password on the sign-in page.`,
    "",
    "If that wasn't you, you can ignore this email. Nothing has changed on your account.",
    "",
    `— ${APP_NAME}`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;color:#2a1d16">
<p>Someone tried to create a ${escapeHtml(APP_SHORT_NAME)} account with this email. You already have one: sign in, or use Forgot password on the sign-in page.</p>
<p>If that wasn&rsquo;t you, you can ignore this email. Nothing has changed on your account.</p>
<p style="color:#7a6a60">&mdash; ${escapeHtml(APP_NAME)}</p>
</div>`;
  return { to, subject: `You already have a ${APP_SHORT_NAME} account`, text, html };
}

// ── Step 2: use the code ──────────────────────────────────────────────────

const verifySchema = z.object({ email: emailSchema, code: codeSchema });

export type CompleteSignupResult =
  | { ok: true; user: { id: string; email: string; sessionVersion: number } }
  | {
      ok: false;
      code: "DISABLED" | "INVALID" | "LOCKED" | "WRONG_CODE" | "TAKEN";
      error: string;
      retryAfterSec?: number;
    };

const wrong = { ok: false, code: "WRONG_CODE", error: WRONG_CODE_MESSAGE } as const;
const taken = { ok: false, code: "TAKEN", error: EMAIL_TAKEN_MESSAGE } as const;

export async function completeSignup(input: unknown, ip: string | null): Promise<CompleteSignupResult> {
  if (!(await signupsAvailable())) return DISABLED;

  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID", error: firstIssue(parsed.error) };
  const { email, code } = parsed.data;

  // On top of the per-code count, which starts again with every new code:
  // asking for fresh codes buys no extra guesses.
  const keys = signupKeys.verify(email, ip);
  const state = await reserveLoginAttempt(keys);
  if (state.locked) {
    return { ok: false, code: "LOCKED", error: "Too many attempts.", retryAfterSec: state.retryAfterSec };
  }

  const row = await prisma.signupRequest.findUnique({ where: { email } });
  if (!row) {
    // The same HMAC a real check costs, so a miss is not obviously quicker.
    hashCode(code, email);
    return wrong;
  }
  const now = new Date();
  const right = await tryCode(
    () =>
      prisma.signupRequest.updateMany({
        where: { id: row.id, codeHash: row.codeHash, expiresAt: { gt: now }, attempts: { lt: CODE_MAX_ATTEMPTS } },
        data: { attempts: { increment: 1 } },
      }),
    row.codeHash,
    hashCode(code, email),
  );
  if (!right) return wrong;

  let outcome: CompleteSignupResult;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<CompleteSignupResult> => {
      await lockTeam(tx);
      // Closed since the code was sent: the owner's call stands.
      if (!(await readSignupsOpen(tx))) return DISABLED;
      // Claimed here: of two right answers at once, one makes the account.
      // Matching the hash too means a request replaced meanwhile (a new
      // code, perhaps a new password) is not finished with the old code.
      const claimed = await tx.signupRequest.deleteMany({ where: { id: row.id, codeHash: row.codeHash } });
      if (claimed.count === 0) return wrong;
      // Somebody got this address first — an owner adding them, say. The
      // pending row is gone either way, and the person has proved the
      // address is theirs, so saying so gives nothing away.
      if (await emailInUse(tx, email)) return taken;
      const user = await tx.user.create({
        data: {
          name: row.name,
          email,
          passwordHash: row.passwordHash,
          role: "STAFF",
          // They chose this password themselves, at step one.
          mustChangePassword: false,
          active: true,
          color: colorForSeed(email),
        },
        select: { id: true, email: true, name: true, sessionVersion: true },
      });
      await tx.teamEvent.create({ data: { type: "joined", userId: user.id } });
      // New people appear in the board's assignee pickers.
      await bumpRevision(tx);
      return { ok: true, user: { id: user.id, email: user.email, sessionVersion: user.sessionVersion } };
    });
  } catch (err) {
    // The unique index, if the address was taken between the check and the insert.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return taken;
    throw err;
  }
  if (!outcome.ok) return outcome;

  await clearLoginFailures(keys);
  scheduleTeamPush({ type: "joined", userId: outcome.user.id, name: row.name });
  console.warn(`Self sign-up: ${email} joined as Staff (ip ${ip ?? "unknown"})`);
  return outcome;
}
