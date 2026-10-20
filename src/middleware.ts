import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";

// Matched exactly: a prefix test would make any future route that merely
// starts with "/login" public by accident.
const PUBLIC_EXACT = new Set(["/login", "/setup", "/api/auth"]);
const PUBLIC_PREFIXES = ["/api/auth/"];

export default NextAuth(authConfig).auth((req) => {
  const { pathname } = req.nextUrl;
  if (PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  if (!req.auth) {
    // An API caller wants a status, not a login page it cannot render.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  // sw.js and manifest.webmanifest stay public alongside the images: the
  // browser fetches both outside any page's session (service-worker update
  // checks, the install prompt), and a login redirect would break push.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)",
  ],
};
