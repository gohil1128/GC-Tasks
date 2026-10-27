import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

/*
  Signing someone in who has just proved who they are without typing a
  password: a person finishing sign-up enters only the emailed code, and
  the password they chose at step one is long gone (only its hash was
  kept). The sign-up action mints one of these and hands it straight to
  signIn() on the server, to the "signup-ticket" provider in
  src/lib/auth.ts; it never reaches the browser.

  A ticket is the account id, its sessionVersion and an expiry, signed with
  AUTH_SECRET. It lives two minutes and dies early if the account is
  deactivated or its sessions are revoked (both move sessionVersion), so
  even a leaked one is worth very little. The provider's endpoint is
  public like every Auth.js callback, but without the secret nobody can
  make a ticket for it to accept.
*/

const TICKET_TTL_MS = 2 * 60 * 1000;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(`signin-ticket:${payload}`).digest("hex");
}

export function issueSigninTicket(user: { id: string; sessionVersion: number }, now = Date.now()): string {
  const payload = `${user.id}.${user.sessionVersion}.${now + TICKET_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

/** The account a ticket signs in, as the Credentials provider returns it, or null. */
export async function userForTicket(ticket: unknown, now = Date.now()) {
  if (typeof ticket !== "string" || ticket.length > 300) return null;
  const parts = ticket.split(".");
  if (parts.length !== 4) return null;
  const [id, version, expires, mac] = parts as [string, string, string, string];

  const want = Buffer.from(sign(`${id}.${version}.${expires}`), "hex");
  const got = Buffer.from(mac, "hex");
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const expiresAt = Number(expires);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + TICKET_TTL_MS) return null;

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, active: true, sessionVersion: true },
  });
  if (!user || !user.active || String(user.sessionVersion) !== version) return null;
  return { id: user.id, email: user.email, name: user.name, sessionVersion: user.sessionVersion };
}
