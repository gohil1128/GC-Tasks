/*
  Where to send someone once they have signed in.

  The value arrives in the query string, so anyone can write a link to
  /login?next=… and send it round. If that link could point off-site, the
  sign-in form would become a way to make a look-alike page appear to come
  from us — an open redirect. So only a path on this site is accepted, and
  anything doubtful falls back to the board.

  Browsers are generous about what counts as "another site": "//evil.example"
  and "/\evil.example" both leave, and tabs and newlines inside a URL are
  dropped before it is followed, so "/\t/evil.example" leaves too. The value
  is also resolved the way a browser would and checked again afterwards,
  because "/..//evil.example" only becomes "//evil.example" once the dots
  are resolved.

  Pure and dependency-free so it can be unit-tested and used on either side.
*/

export const DEFAULT_NEXT = "/";

// Going back to these after signing in would only bounce off them again.
const NOT_A_DESTINATION = ["/login", "/setup"];

// Any origin we own would do; this one can never resolve, which is the point.
const BASE = "http://gc-tasks.invalid";

function hasControlOrBackslash(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || value[i] === "\\") return true;
  }
  return false;
}

function isSameOriginPath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return DEFAULT_NEXT;
  if (!isSameOriginPath(value) || hasControlOrBackslash(value)) return DEFAULT_NEXT;

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return DEFAULT_NEXT;
  }
  if (url.origin !== BASE) return DEFAULT_NEXT;

  const resolved = url.pathname + url.search + url.hash;
  if (!isSameOriginPath(resolved)) return DEFAULT_NEXT;
  if (NOT_A_DESTINATION.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) {
    return DEFAULT_NEXT;
  }
  return resolved;
}
