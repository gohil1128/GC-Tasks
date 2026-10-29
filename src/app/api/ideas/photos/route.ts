import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { MAX_PHOTO_BYTES, savePhotoUpload } from "@/modules/ideas/photos";

/*
  Upload one photo for an idea or reply, before the post is shared. The body
  is the image itself (already shrunk on the phone); ?w= and ?h= give its
  size for laying it out. Answers { id, width, height }; the post names the
  id when it is shared. See src/modules/ideas/photos.ts.
*/
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  let actor;
  try {
    const user = await requireUser();
    actor = { id: user.id, role: user.role };
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code === "UNAUTHORIZED") return fail(401, "UNAUTHORIZED");
    if (code === "PASSWORD_CHANGE_REQUIRED") return fail(403, "PASSWORD_CHANGE_REQUIRED");
    throw err;
  }

  // Turned away before reading it, when it says up front that it is too big.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_PHOTO_BYTES) return fail(413, "That photo is too large.");
  const bytes = new Uint8Array(await request.arrayBuffer());

  const url = new URL(request.url);
  const result = await savePhotoUpload(actor, bytes, {
    width: url.searchParams.get("w"),
    height: url.searchParams.get("h"),
  });
  if (!result.ok) return fail(result.status, result.error);
  return NextResponse.json(result.photo, { status: 201, headers: NO_STORE });
}
