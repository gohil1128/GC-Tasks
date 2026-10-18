import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/*
  Sign-in throttling, the same scheme God's Chai Operations uses.

  Counters live in the database because serverless instances do not share
  memory. Two keys per attempt:
    email:<address>  — guessing at one account
    ip:<addr>        — spraying one password across many accounts
  Failures are forgiven once a window has passed since the last one — or, if
  it was locked, since the lock ended. Counting from the end of the lock is
  what lets the failures after a lock run on to the long lock; counted from
  the failure itself, a lock exactly as long as the window always outlasted
  it, and every lock started the count again from one.
*/

const WINDOW_MS = 15 * 60 * 1000;
export const EMAIL_MAX = 5;
export const IP_MAX = 20; // higher: a café's wifi is one address for everyone on it
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
 * A look at the lock without touching it, so a form can say how long to
 * wait. It decides nothing: between this read and the password check a
 * parallel attempt can take the last slot, which is why the check is gated
 * by reserveLoginAttempt instead.
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
  return { locked: true, retryAfterSec: retryAfter(until, now) };
}

function retryAfter(until: Date, now: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
}

class Refused extends Error {
  constructor(public retryAfterSec: number) {
    super("LOGIN_LOCKED");
  }
}

// The columns hold UTC without a zone and Prisma sends a Date with one, so
// say which zone, or the comparison follows the connection's TimeZone setting.
const utc = (d: Date) => Prisma.sql`(${d} AT TIME ZONE 'UTC')`;

/**
 * Takes one attempt from every key BEFORE the password is checked, and is
 * the only thing that decides whether the check happens. Looking at the lock
 * and writing the failure once the password had been checked would let a
 * burst of parallel attempts all through before the first failure landed,
 * and a read-then-write counter loses all but one of simultaneous failures.
 * So each key is a single INSERT … ON CONFLICT DO UPDATE: parallel attempts
 * queue on the row and each takes its own slot.
 *
 * The attempt is counted as a failure up front — with the lock, when it is
 * the one that reaches the limit — and a correct password then clears it
 * with clearLoginFailures. A key that is already locked is refused without
 * being counted, and the whole reservation rolls back, so an attempt the IP
 * lock refuses does not use up the account's slots, or the other way round.
 *
 * Identical whether or not the address exists — otherwise the lockout itself
 * would reveal which addresses are real.
 */
export async function reserveLoginAttempt(keys: string[]): Promise<RateLimitState> {
  if (keys.length === 0) return { locked: false };
  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      // Always in the same order, so two attempts never hold each other's rows.
      for (const key of [...keys].sort()) {
        const max = key.startsWith("ip:") ? IP_MAX : EMAIL_MAX;
        const failures = Prisma.sql`CASE
          WHEN COALESCE(a."lockedUntil", a."updatedAt") < ${utc(new Date(now.getTime() - WINDOW_MS))} THEN 1
          ELSE a."failures" + 1
        END`;
        const taken = await tx.$queryRaw<{ key: string }[]>`
          INSERT INTO "LoginAttempt" AS a ("key", "failures", "lockedUntil", "updatedAt")
          VALUES (${key}, 1, NULL, ${utc(now)})
          ON CONFLICT ("key") DO UPDATE SET
            "failures" = ${failures},
            "lockedUntil" = CASE
              WHEN ${failures} >= ${max * LONG_LOCK_MULTIPLE} THEN ${utc(new Date(now.getTime() + LONG_LOCK_MS))}
              WHEN ${failures} >= ${max} THEN ${utc(new Date(now.getTime() + LOCK_MS))}
            END,
            "updatedAt" = ${utc(now)}
          WHERE a."lockedUntil" IS NULL OR a."lockedUntil" <= ${utc(now)}
          RETURNING a."key"`;
        if (taken.length === 0) {
          // The conflicting row stays locked to this transaction, so this reads the lock that refused us.
          const row = await tx.loginAttempt.findUnique({ where: { key }, select: { lockedUntil: true } });
          throw new Refused(row?.lockedUntil ? retryAfter(row.lockedUntil, now) : 1);
        }
      }
    });
  } catch (err) {
    if (err instanceof Refused) return { locked: true, retryAfterSec: err.retryAfterSec };
    throw err;
  }
  return { locked: false };
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
