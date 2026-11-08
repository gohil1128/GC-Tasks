import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { isOwner } from "@/lib/permissions";
import { signState } from "@/modules/mail/crypto";
import { googleAuthUrl } from "@/modules/mail/gmail";
import { missingConnectConfig } from "@/modules/mail/service";

/*
  Starts "Connect Gmail". Owners only — the connection reads the business's
  email.

  Nothing is stored here. The state is a signed, ten-minute token naming the
  person who clicked, which the callback checks, so a link someone else sends
  you cannot attach THEIR Google grant to this board.
*/
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (!me || me.mustChangePassword || !isOwner(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (missingConnectConfig().length > 0) {
    return NextResponse.redirect(new URL("/settings?mail=not-configured#email-tasks", req.url));
  }
  return NextResponse.redirect(googleAuthUrl(signState(me.id)));
}
