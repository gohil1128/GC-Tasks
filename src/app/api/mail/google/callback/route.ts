import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { isOwner } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { INITIAL_LOOKBACK_DAYS } from "@/modules/mail/config";
import { decryptSecret, encryptSecret, verifyState } from "@/modules/mail/crypto";
import { exchangeCode, fetchProfileEmail, GMAIL_SCOPE, revokeToken } from "@/modules/mail/gmail";

/*
  Where Google sends the browser back.

  Three checks before anything is stored, in order of how bad it is to skip
  them: the state must be genuine and unexpired; it must have been issued to
  the person signed in now (otherwise an attacker could finish THEIR consent
  screen in YOUR session); and the grant must really include the read
  permission, because Google lets a person untick it on the consent screen.
*/
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const back = (mail: string) => NextResponse.redirect(new URL(`/settings?mail=${mail}#email-tasks`, req.url));

  const me = await currentUser();
  if (!me || me.mustChangePassword || !isOwner(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const q = req.nextUrl.searchParams;
  if (q.get("error")) return back("denied");
  const state = verifyState(q.get("state"));
  if (!state || state.uid !== me.id) return back("bad-state");
  const code = q.get("code");
  if (!code) return back("bad-state");

  try {
    const grant = await exchangeCode(code);
    if (!grant.scope.split(" ").includes(GMAIL_SCOPE)) {
      await revokeToken(grant.refreshToken);
      return back("no-permission");
    }
    const accountEmail = await fetchProfileEmail(grant.accessToken);
    const existing = await prisma.mailConnection.findUnique({ where: { id: 1 } });

    const data = {
      connectedById: me.id,
      accountEmail,
      refreshTokenEnc: encryptSecret(grant.refreshToken),
      scope: grant.scope,
      status: "ACTIVE",
      statusNote: null,
    };
    // A different mailbox starts its own short lookback; the same one keeps
    // its cursor, so nothing is re-read or skipped.
    const fresh = new Date(Date.now() - INITIAL_LOOKBACK_DAYS * 86_400_000);
    await prisma.mailConnection.upsert({
      where: { id: 1 },
      create: { id: 1, ...data, scannedThrough: fresh },
      update: existing && existing.accountEmail !== accountEmail ? { ...data, scannedThrough: fresh } : data,
    });

    // A replaced grant is revoked so the old one cannot be used from anywhere.
    if (existing) await revokeToken(decryptSecret(existing.refreshTokenEnc)).catch(() => {});
    return back("connected");
  } catch (e) {
    console.error("[mail] connect failed:", e instanceof Error ? e.message : e);
    return back("failed");
  }
}
