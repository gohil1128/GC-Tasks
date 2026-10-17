import type { NextConfig } from "next";
import path from "node:path";

// The same baseline headers God's Chai Operations sends. No CSP: Next injects
// inline hydration scripts, and a strict policy needs nonces threaded through
// the document — a change of its own.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // This app sits inside the God's Chai Operations repo, which has its own
  // lockfile one level up. Without this, Next guesses the PARENT as the
  // workspace root and traces files from there.
  outputFileTracingRoot: path.join(__dirname),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
