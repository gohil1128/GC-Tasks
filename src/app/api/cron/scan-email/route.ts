import { NextResponse, type NextRequest } from "next/server";
import { MailConfigError, safeEqual } from "@/modules/mail/crypto";
import { missingConfig, runNightly } from "@/modules/mail/service";

/*
  The nightly entry point. Vercel Cron calls it (vercel.json) a few times
  each night in UTC; runNightly() works out from the Winnipeg clock which call
  is midnight there and scans once.

  Public to the session middleware — a scheduler has no login — and protected
  by a shared secret instead, so everything rides on that comparison. Vercel
  sends CRON_SECRET as a bearer token. The compare is constant-time, it fails
  CLOSED when the secret is not configured (a missing secret must never mean
  "anyone may call this"), and the answer is counts only: no sender, no
  subject, nothing from any email.
*/

// The platform's ceiling on a function; the scan budgets itself well inside it.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  const given = req.headers.get("authorization") ?? "";
  if (!safeEqual(given, `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Not set up yet is an expected state, not an outage: say which settings (names only).
  const missing = missingConfig();
  if (missing.length > 0) return NextResponse.json({ ok: false, error: `Not configured: ${missing.join(", ")}.` }, { status: 503 });

  try {
    const r = await runNightly();
    const { ran, note, decision, listed, read, tasks, comments, skipped, failed, partial, error } = r;
    return NextResponse.json({ ok: true, ran, note, decision, listed, read, tasks, comments, skipped, failed, partial, error });
  } catch (e) {
    // Not-yet-configured is an expected state, not an outage.
    if (e instanceof MailConfigError) return NextResponse.json({ ok: false, error: e.message }, { status: 503 });
    console.error("[mail] nightly scan failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "Scan failed." }, { status: 500 });
  }
}

// Vercel Cron calls with GET; POST is there for a manual curl.
export const GET = handle;
export const POST = handle;
