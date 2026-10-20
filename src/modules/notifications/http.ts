import { NextResponse } from "next/server";
import { requireUser, type CurrentUser } from "@/lib/auth";

/*
  The notifications endpoints' gate, the same shape as modules/tasks/http:
  responses are no-store (the bell polls), signed out is 401, an account
  still on a temporary password is 403. Unlike readJson these handlers need
  to know WHO is asking — the feed is per-person — so the handler receives
  the signed-in user.
*/

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function withUser(
  handler: (me: CurrentUser) => Promise<NextResponse>,
): Promise<NextResponse> {
  let me: CurrentUser;
  try {
    me = await requireUser();
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code === "UNAUTHORIZED") return json({ error: "UNAUTHORIZED" }, 401);
    if (code === "PASSWORD_CHANGE_REQUIRED") return json({ error: "PASSWORD_CHANGE_REQUIRED" }, 403);
    throw err;
  }
  return handler(me);
}
