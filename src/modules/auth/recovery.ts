import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordSchema } from "@/modules/auth/password";
import { clearLoginFailures, loginKeys, reserveLoginAttempt } from "@/modules/auth/rate-limit";
import { emailSchema, firstIssue } from "@/modules/team/schemas";

/*
  The way back in when nobody can sign in: no owner remembers a password,
  so nobody can reset one from the Team page.

  Not a master password. RECOVERY_KEY is a long secret set in the hosting
  settings, which only the people who run the deployment can read. With it,
  /recover sets a new password on ONE account; it never signs anyone in as
  someone else. Remove the variable and the page is gone.

  Guesses at the key count against the same lockout as sign-in, keyed by
  address and by a single "recover" key, so the page cannot be used to guess
  the key quickly from many addresses either. Every use is logged.
*/

/** Shorter than this and it is not worth calling a secret. */
export const MIN_RECOVERY_KEY_LENGTH = 24;

const RECOVER_KEY = "recover:all";

export function recoveryEnabled(): boolean {
  return (process.env.RECOVERY_KEY ?? "").length >= MIN_RECOVERY_KEY_LENGTH;
}

const recoverSchema = z
  .object({
    key: z.string().min(1, "Enter the recovery key."),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "The two passwords don't match.",
    path: ["confirmPassword"],
  });

/** Compares digests, so neither the key's length nor its prefix leaks through timing. */
function keyMatches(given: string): boolean {
  const want = createHash("sha256").update(process.env.RECOVERY_KEY ?? "").digest();
  const got = createHash("sha256").update(given).digest();
  return timingSafeEqual(want, got);
}

export type RecoverResult =
  | { ok: true; email: string }
  | { ok: false; code: "DISABLED" | "INVALID" | "LOCKED" | "WRONG_KEY" | "NO_ACCOUNT"; error: string; retryAfterSec?: number };

export async function recoverAccount(input: unknown, ip: string | null): Promise<RecoverResult> {
  if (!recoveryEnabled()) return { ok: false, code: "DISABLED", error: "Account recovery is switched off." };

  const parsed = recoverSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID", error: firstIssue(parsed.error) };
  const { key, email, password } = parsed.data;

  // Taken before the key is compared, like a sign-in, so parallel guesses
  // cannot all slip in under the limit.
  const keys = [RECOVER_KEY, ...(ip ? [`recover-ip:${ip}`] : [])];
  const state = await reserveLoginAttempt(keys);
  if (state.locked) {
    return { ok: false, code: "LOCKED", error: "Too many attempts.", retryAfterSec: state.retryAfterSec };
  }
  if (!keyMatches(key)) {
    console.warn(`Account recovery refused: wrong key (ip ${ip ?? "unknown"})`);
    return { ok: false, code: "WRONG_KEY", error: "That recovery key isn't right." };
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    await clearLoginFailures(keys);
    return { ok: false, code: "NO_ACCOUNT", error: "There's no account with that email." };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(password),
      // They chose this password themselves, just now.
      mustChangePassword: false,
      active: true,
      // Whoever was signed in as them before is not any more.
      sessionVersion: { increment: 1 },
    },
  });
  await clearLoginFailures([...keys, ...loginKeys(email, null)]);
  console.warn(`Account recovery used: new password set for ${email} (ip ${ip ?? "unknown"})`);
  return { ok: true, email };
}
