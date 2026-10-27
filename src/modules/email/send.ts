import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/*
  Outgoing email, through Resend's REST API with a plain fetch — one POST
  is not worth a dependency.

  Optional, like push: without RESEND_API_KEY and EMAIL_FROM nothing that
  needs email is offered (the sign-in page keeps "ask an owner"), so a
  deployment that never sets them loses nothing.

  EMAIL_DEV_LOG_DIR is for local browser tests only: when set, each email
  is written to a JSON file in that folder instead of being sent, so a
  test can read the code without a real inbox. It is ignored on Vercel, so
  a stray copy of the variable can never put codes on disk in production.
*/

const RESEND_URL = "https://api.resend.com/emails";

export type OutgoingEmail = { to: string; subject: string; text: string; html: string };

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

function devLogDir(): string | null {
  const dir = process.env.EMAIL_DEV_LOG_DIR?.trim();
  if (!dir || process.env.VERCEL) return null;
  return dir;
}

/** Sends one email, or throws. The error never carries the message body. */
export async function sendEmail(email: OutgoingEmail): Promise<void> {
  if (!emailConfigured()) throw new Error("Email is not configured (RESEND_API_KEY / EMAIL_FROM).");
  const from = process.env.EMAIL_FROM!.trim();

  const dir = devLogDir();
  if (dir) {
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${Date.now()}-${randomUUID()}.json`);
    await writeFile(file, JSON.stringify({ from, ...email, to: [email.to] }, null, 2));
    console.warn(`EMAIL_DEV_LOG_DIR is set: email to ${email.to} written to ${file}, not sent`);
    return;
  }

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
    // A hung provider must not hold the request open indefinitely.
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Resend's error body says what was wrong (unverified domain, bad key)
    // and never echoes the email back, so it is safe to log.
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Resend answered ${res.status}: ${detail}`);
  }
}
