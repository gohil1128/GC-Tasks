import { requireUser } from "@/lib/auth";
import { readPhoto } from "@/modules/ideas/photos";

/*
  One photo, for signed-in teammates. A photo never changes once uploaded
  (editing a post swaps photos, it never rewrites one), so the browser may
  keep it for good; it is private to the person's own browser all the same.
  Served as the image type its bytes were checked to be, with nosniff and a
  no-scripts policy, so it can only ever be shown as an image.
*/
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let viewer;
  try {
    const user = await requireUser();
    viewer = { id: user.id, role: user.role };
  } catch {
    return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const { id } = await params;
  const photo = await readPhoto(viewer, id);
  if (!photo) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(Buffer.from(photo.bytes), {
    status: 200,
    headers: {
      "Content-Type": photo.mime,
      "Content-Length": String(photo.bytes.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}
