import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/*
  The six-digit codes the app emails — "Forgot password?" and sign-up —
  and the rules they share: ten minutes, five wrong tries, one use.

  Only an HMAC of a code is ever stored, keyed by AUTH_SECRET and bound to
  what it is for and who it is for, so a copy of a table is no use without
  the secret and a code row moved to another account or another purpose
  matches nothing.
*/

export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
const CODE_DIGITS = 6;

export const WRONG_CODE_MESSAGE = "That code isn't right or has expired.";

/** Hands slow work to run after the response (the actions pass Next's after()). */
export type Defer = (work: () => Promise<void>) => void;

/** The code field: spaces forgiven, then exactly six digits. */
export const codeSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code from the email."));

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set");
  return value;
}

export function newCode(): string {
  return randomInt(0, 10 ** CODE_DIGITS).toString().padStart(CODE_DIGITS, "0");
}

/** `purpose` and `subject` (an account id, an address) are part of what is signed. */
export function hashCode(purpose: string, subject: string, code: string): Buffer {
  return createHmac("sha256", secret()).update(`${purpose}:${subject}:${code}`).digest();
}

/**
 * One try at a stored code. `take` claims the try in a single conditional
 * write — counting it only while the code is unexpired, unused and under
 * its limit — and runs BEFORE the comparison, so parallel guesses cannot
 * all slip in under the limit (the same idea as reserveLoginAttempt). A
 * spent, expired or used code takes nothing and never matches.
 */
export async function tryCode(
  take: () => Promise<{ count: number }>,
  storedHex: string,
  got: Buffer,
): Promise<boolean> {
  const taken = await take();
  const want = Buffer.from(storedHex, "hex");
  const matches = want.length === got.length && timingSafeEqual(want, got);
  return taken.count > 0 && matches;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
