import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/*
  The two secrets this feature handles, and how each is kept.

  THE REFRESH TOKEN is a standing permission to read a mailbox. It is stored
  in the database, and a database is read by backups, by whoever has the
  connection string, and by anyone a future bug lets run a query — so it is
  encrypted before it is written (AES-256-GCM) with a key that is NOT in the
  database. A copy of the table alone is then a list of opaque strings. GCM
  is authenticated, so a token that was altered in the table fails to decrypt
  rather than decrypting to something else.

  THE OAUTH STATE is what stops somebody else's authorisation code being
  attached to your account (login CSRF). It is signed, short-lived and bound
  to the user who started the flow, and the callback checks all three.

  One key, MAIL_TOKEN_KEY (32 random bytes, base64), with a separate derived
  subkey per purpose so a signature can never be mistaken for ciphertext.
*/

export class MailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailConfigError";
  }
}

function masterKey(): Buffer {
  const raw = process.env.MAIL_TOKEN_KEY;
  if (!raw) throw new MailConfigError("MAIL_TOKEN_KEY is not set.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new MailConfigError("MAIL_TOKEN_KEY must be 32 random bytes, base64-encoded.");
  }
  return key;
}

function subkey(purpose: string): Buffer {
  return createHmac("sha256", masterKey()).update(`gc-mail:${purpose}`).digest();
}

const b64u = (b: Buffer) => b.toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");

/** v1.<iv>.<tag>.<ciphertext>, each base64url. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subkey("encrypt"), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", b64u(iv), b64u(cipher.getAuthTag()), b64u(ct)].join(".");
}

export function decryptSecret(blob: string): string {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised encrypted value.");
  const decipher = createDecipheriv("aes-256-gcm", subkey("encrypt"), fromB64u(iv));
  decipher.setAuthTag(fromB64u(tag));
  return Buffer.concat([decipher.update(fromB64u(ct)), decipher.final()]).toString("utf8");
}

export type OAuthState = { uid: string; exp: number; n: string };

export function signState(uid: string, ttlMs = 10 * 60_000, now = Date.now()): string {
  const body = b64u(Buffer.from(JSON.stringify({ uid, exp: now + ttlMs, n: b64u(randomBytes(9)) })));
  const sig = b64u(createHmac("sha256", subkey("state")).update(body).digest());
  return `${body}.${sig}`;
}

/** The payload, or null for anything forged, malformed or expired. */
export function verifyState(token: string | null | undefined, now = Date.now()): OAuthState | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", subkey("state")).update(body).digest();
  const got = fromB64u(sig);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(fromB64u(body).toString("utf8")) as OAuthState;
    if (typeof p.uid !== "string" || typeof p.exp !== "number" || p.exp < now) return null;
    return p;
  } catch {
    return null;
  }
}

/**
 * Constant-time string comparison that does not leak length either: both sides
 * are hashed first, so the comparison is always over two 32-byte values.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
