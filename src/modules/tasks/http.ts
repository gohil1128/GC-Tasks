import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import type { Actor } from "@/lib/permissions";

/*
  The board's read endpoints, behind the same gate as the actions. The
  middleware already turns away requests with no session cookie, but only
  this check reads the account from the database, so it is the one that sees
  a deactivated person or a password still to change.

  Every response is no-store: these are polled, and a cached answer is a
  board that silently stops updating.
*/

const NO_STORE = { "Cache-Control": "no-store" } as const;

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
  Signed in → `read(actor)` as JSON, for the person asking (what staff may
  see depends on who they are); signed out → 401 { error: "UNAUTHORIZED" };
  must change password → 403 { error: "PASSWORD_CHANGE_REQUIRED" }; and
  `read()` returning null → 404 { error: "NOT_FOUND" }.
*/
export async function readJson(read: (actor: Actor) => Promise<unknown>): Promise<NextResponse> {
  let actor: Actor;
  try {
    const user = await requireUser();
    actor = { id: user.id, role: user.role };
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code === "UNAUTHORIZED") return json({ error: "UNAUTHORIZED" }, 401);
    if (code === "PASSWORD_CHANGE_REQUIRED") return json({ error: "PASSWORD_CHANGE_REQUIRED" }, 403);
    throw err;
  }
  const body = await read(actor);
  if (body === null) return json({ error: "NOT_FOUND" }, 404);
  return json(body, 200);
}
