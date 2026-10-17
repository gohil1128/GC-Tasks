import { prisma } from "@/lib/prisma";

/*
  Sign-in throttling, the same scheme God's Chai Operations uses.

  Counters live in the database because serverless instances do not share
  memory. Two keys per attempt:
    email:<address>  — guessing at one account
    ip:<addr>        — spraying one password across many accounts
  Failures older than the window are forgiven.
*/

const WINDOW_MS = 15 * 60 * 1000;
const EMAIL_MAX = 5;
const IP_MAX = 20; // higher: a café's wifi is one address for everyone on it
const LOCK_MS = 15 * 60 * 1000;
const LONG_LOCK_MULTIPLE = 2;
const LONG_LOCK_MS = 60 * 60 * 1000;

export type RateLimitState = { locked: true; retryAfterSec: number } | { locked: false };

export function loginKeys(email: string, ip: string | null): string[] {
  const keys = [`email:${email.trim().toLowerCase()}`];
  if (ip) keys.push(`ip:${ip}`);
  return keys;
}

/** Best-effort client address from the proxy chain. */
export function clientIpFrom(headers: Headers): string | null {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim() || null;
  return headers.get("x-real-ip");
}

/**
 * Checked BEFORE the password, and identical whether or not the address
 * exists — otherwise the lockout itself would reveal which addresses are real.
 */
export async function checkLoginAllowed(keys: string[]): Promise<RateLimitState> {
  if (keys.length === 0) return { locked: false };
  const now = new Date();
  const rows = await prisma.loginAttempt.findMany({ where: { key: { in: keys } } });
  let until: Date | null = null;
  for (const r of rows) {
    if (r.lockedUntil && r.lockedUntil > now && (!until || r.lockedUntil > until)) {
      until = r.lockedUntil;
    }
  }
  if (!until) return { locked: false };
  return { locked: true, retryAfterSec: Math.ceil((until.getTime() - now.getTime()) / 1000) };
}

export async function recordLoginFailure(keys: string[]): Promise<void> {
  const now = new Date();
  await Promise.all(
    keys.map(async (key) => {
      const max = key.startsWith("ip:") ? IP_MAX : EMAIL_MAX;
      const existing = await prisma.loginAttempt.findUnique({ where: { key } });
      const stale = existing ? now.getTime() - existing.updatedAt.getTime() > WINDOW_MS : false;
      const failures = (stale || !existing ? 0 : existing.failures) + 1;
      const lockedUntil =
        failures >= max * LONG_LOCK_MULTIPLE
          ? new Date(now.getTime() + LONG_LOCK_MS)
          : failures >= max
            ? new Date(now.getTime() + LOCK_MS)
            : null;
      await prisma.loginAttempt.upsert({
        where: { key },
        create: { key, failures, lockedUntil },
        update: { failures, lockedUntil },
      });
    }),
  );
}

/** A correct password clears the record for that address. */
export async function clearLoginFailures(keys: string[]): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { key: { in: keys } } });
}

/** Thrown by `authorize` so the sign-in form can explain the wait. */
export class LoginLockedError extends Error {
  constructor(public retryAfterSec: number) {
    super("LOGIN_LOCKED");
    this.name = "LoginLockedError";
  }
}
