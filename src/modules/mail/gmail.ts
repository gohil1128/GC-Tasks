import { MailConfigError } from "./crypto";

/*
  Gmail, read-only.

  The one scope requested is gmail.readonly. That is not a courtesy: it is
  what makes the worst case bounded. Whatever a bug or a malicious email
  managed to do, this connection cannot send a message, delete one, change a
  label or forward anything — Google rejects it.

  This file is plain fetch against Google's REST API rather than the googleapis
  package, which is a very large dependency for four endpoints.

  The pipeline never touches this directly: it takes a MailClient, so tests
  hand it a fake mailbox and nothing here needs a network to be exercised.
*/

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Raised when Google no longer honours the grant: revoked, expired, or removed. */
export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailAuthError";
  }
}

export type MailAttachmentRef = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type MailItem = {
  id: string;
  threadId: string;
  fromAddress: string;
  fromName: string;
  subject: string;
  receivedAt: Date;
  /**
   * Whether Gmail's own sender checks vouch that this really came from the
   * address in From. From is just text the sender chose, so a task made from
   * mail that fails these checks says so.
   */
  authenticated: boolean;
  /** Plain text of the body, HTML stripped. Callers truncate to what they need. */
  text: string;
  /** Only attachments the model can read: PDF and raster images. */
  attachments: MailAttachmentRef[];
};

export interface MailClient {
  /** Message ids matching a Gmail search, newest first. */
  listIds(query: string, max: number): Promise<string[]>;
  get(id: string): Promise<MailItem>;
  attachment(messageId: string, attachmentId: string): Promise<Buffer>;
}

function oauthEnv() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  const redirect = process.env.GOOGLE_REDIRECT_URI;
  if (!id || !secret || !redirect) {
    throw new MailConfigError("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI must be set.");
  }
  return { id, secret, redirect };
}

export const googleConfigured = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);

export function googleAuthUrl(state: string, loginHint?: string): string {
  const { id, redirect } = oauthEnv();
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: id,
    redirect_uri: redirect,
    response_type: "code",
    scope: GMAIL_SCOPE,
    // offline + consent: without consent Google omits the refresh token on a
    // reconnect, and a connection with no refresh token dies in an hour.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return u.toString();
}

/** fetch with a timeout and one retry for the failures worth retrying. */
async function http(url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
      if ((res.status === 429 || res.status >= 500) && attempt === 0) {
        const wait = Math.min(Number(res.headers.get("retry-after")) || 1, 5);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      return res;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("Network error talking to Google.");
}

async function tokenRequest(params: Record<string, string>) {
  const { id, secret } = oauthEnv();
  const res = await http(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = String(body.error ?? res.status);
    // invalid_grant is the one that means "this connection is over".
    if (code === "invalid_grant") throw new GmailAuthError("Google no longer accepts this connection.");
    throw new Error(`Google token request failed (${code}).`);
  }
  return body;
}

export async function exchangeCode(code: string) {
  const { redirect } = oauthEnv();
  const body = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirect });
  const refreshToken = body.refresh_token;
  if (typeof refreshToken !== "string" || !refreshToken) {
    throw new Error("Google did not return a refresh token. Remove the app from your Google account's connected apps and try again.");
  }
  return {
    refreshToken,
    accessToken: String(body.access_token),
    scope: String(body.scope ?? ""),
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const body = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  return String(body.access_token);
}

/** Best effort: if Google is unreachable the local delete still goes ahead. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await http(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    }, 8_000);
  } catch {
    /* the grant can still be removed by hand in the Google account */
  }
}

export async function fetchProfileEmail(accessToken: string): Promise<string> {
  const res = await http(`${API}/profile`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Could not read the Gmail profile (${res.status}).`);
  const j = (await res.json()) as { emailAddress?: string };
  if (!j.emailAddress) throw new Error("Gmail did not say which account this is.");
  return j.emailAddress.toLowerCase();
}

/*
  What is worth reading at all, decided by Gmail before anything reaches a
  model.

  Gmail has already sorted most commercial noise into Promotions, Social and
  Forums, so those are excluded. Spam and Trash are excluded by default and
  say so here anyway. Mail the account sent itself asks nothing of it.
*/
export function buildScanQuery(after: Date): string {
  const epoch = Math.floor(after.getTime() / 1000);
  // No subject keywords: "please sign", "complete the attached" and "can you
  // confirm" share no word worth searching on, so the model reads everything
  // Gmail itself has not filed as noise, and decides.
  return [
    `after:${epoch}`,
    "-category:promotions -category:social -category:forums",
    "-in:spam -in:trash -in:drafts -in:sent -in:chats -from:me",
  ].join(" ");
}

const READABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);
// Below this an "attachment" is a tracking pixel or a signature logo.
const MIN_ATTACHMENT_BYTES = 3_000;

type GPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GPart[];
};

function header(parts: GPart | undefined, name: string): string {
  return parts?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** "Ravi Tent <billing@ravi.ca>" -> { name, address }. */
export function parseFrom(raw: string): { name: string; address: string } {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(raw);
  if (m) return { name: (m[1] ?? "").trim(), address: m[2].trim().toLowerCase() };
  return { name: "", address: raw.trim().toLowerCase() };
}

/*
  Did the mail really come from the domain it says?

  Gmail checks every message (SPF, DKIM, DMARC) and records the verdict in an
  Authentication-Results header that it ADDS ON TOP of the message. So:

   - Only the FIRST such header is read, and only if it names mx.google.com as
     the one that wrote it. A sender can put a forged "dmarc=pass" header of
     their own into the message, but Gmail's sits above it, and a lower one is
     never consulted.
   - It counts as authenticated when DMARC passed, or when a DKIM signature
     passed for the SAME domain as From (an aligned signature). A DKIM pass for
     some unrelated domain proves nothing about who From is, so it does not
     count. SPF alone is not accepted: it vouches for an envelope address
     that need not match From unless DMARC says it aligned.
   - No header, or a verdict of none/fail/softfail, is "not authenticated".
*/
export function isAuthenticated(headerValue: string | undefined, fromAddress: string): boolean {
  if (!headerValue) return false;
  const v = headerValue.toLowerCase();
  const [serv, ...rest] = v.split(";");
  if (serv.trim() !== "mx.google.com") return false;
  const results = rest.join(";");
  if (/\bdmarc=pass\b/.test(results)) return true;

  const fromDomain = fromAddress.toLowerCase().split("@")[1];
  if (!fromDomain) return false;
  const aligned = (d: string) => d === fromDomain || fromDomain.endsWith(`.${d}`) || d.endsWith(`.${fromDomain}`);
  for (const m of results.matchAll(/\bdkim=pass\b[^;]*?header\.(?:d|i)=@?([a-z0-9.-]+)/g)) {
    if (aligned(m[1])) return true;
  }
  return false;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6])>|<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function decode(data: string | undefined): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

function walk(part: GPart, out: { plain: string[]; html: string[]; files: MailAttachmentRef[] }) {
  const mime = (part.mimeType ?? "").toLowerCase();
  if (part.filename && part.body?.attachmentId) {
    if (READABLE.has(mime) && (part.body.size ?? 0) >= MIN_ATTACHMENT_BYTES) {
      out.files.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: mime,
        size: part.body.size ?? 0,
      });
    }
  } else if (mime === "text/plain") {
    out.plain.push(decode(part.body?.data));
  } else if (mime === "text/html") {
    out.html.push(decode(part.body?.data));
  }
  for (const child of part.parts ?? []) walk(child, out);
}

export function parseMessage(raw: {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: GPart;
}): MailItem {
  const out = { plain: [] as string[], html: [] as string[], files: [] as MailAttachmentRef[] };
  if (raw.payload) walk(raw.payload, out);
  const from = parseFrom(header(raw.payload, "From"));
  const text = (out.plain.join("\n").trim() || htmlToText(out.html.join("\n"))).trim();
  return {
    id: raw.id,
    threadId: raw.threadId,
    fromAddress: from.address,
    fromName: from.name,
    subject: header(raw.payload, "Subject").trim(),
    authenticated: isAuthenticated(header(raw.payload, "Authentication-Results") || undefined, from.address),
    receivedAt: new Date(Number(raw.internalDate) || Date.now()),
    text,
    attachments: out.files,
  };
}

export function createGmailClient(accessToken: string): MailClient {
  const auth = { authorization: `Bearer ${accessToken}` };

  async function json<T>(url: string): Promise<T> {
    const res = await http(url, { headers: auth });
    if (res.status === 401) throw new GmailAuthError("Gmail rejected the access token.");
    if (!res.ok) throw new Error(`Gmail ${res.status} for ${new URL(url).pathname}`);
    return (await res.json()) as T;
  }

  return {
    async listIds(query, max) {
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const u = new URL(`${API}/messages`);
        u.searchParams.set("q", query);
        u.searchParams.set("maxResults", String(Math.min(100, max - ids.length)));
        if (pageToken) u.searchParams.set("pageToken", pageToken);
        const page = await json<{ messages?: { id: string }[]; nextPageToken?: string }>(u.toString());
        for (const m of page.messages ?? []) ids.push(m.id);
        pageToken = page.nextPageToken;
      } while (pageToken && ids.length < max);
      return ids;
    },
    async get(id) {
      const raw = await json<Parameters<typeof parseMessage>[0]>(`${API}/messages/${id}?format=full`);
      return parseMessage(raw);
    },
    async attachment(messageId, attachmentId) {
      const j = await json<{ data?: string }>(`${API}/messages/${messageId}/attachments/${attachmentId}`);
      return Buffer.from(j.data ?? "", "base64url");
    },
  };
}
