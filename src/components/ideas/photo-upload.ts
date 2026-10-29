/*
  Getting a photo from the phone to the server, small.

  A phone photo is 3–12 MB and 4000px wide; the Ideas page shows it at most a
  screen wide. So it is redrawn here first: no more than MAX_SIDE on its
  longer side, as a JPEG at QUALITY — a few hundred KB, quick on café wifi.
  Redrawing also drops the photo's metadata (location included) and bakes in
  its rotation, so the server only ever stores the pixels.
*/

const MAX_SIDE = 1600;
const QUALITY = 0.82;
/** Bigger than any phone photo, but stops someone feeding the canvas a 200 MB file. */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

export type ShrunkPhoto = { blob: Blob; width: number; height: number };

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      // "from-image" turns a sideways phone photo upright using its own orientation tag.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Some formats (HEIC on some browsers) only decode through an <img>; fall through.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/** The photo redrawn small, as a JPEG. Throws if the browser cannot read it as an image. */
export async function shrinkPhoto(file: File): Promise<ShrunkPhoto> {
  if (file.size > MAX_SOURCE_BYTES) throw new Error("That photo is too large.");
  const image = await decode(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't prepare the photo.");
    // A transparent PNG would turn black as a JPEG; give it the page's paper colour instead.
    ctx.fillStyle = "#fbf8f3";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob) throw new Error("Couldn't prepare the photo.");
    return { blob, width, height };
  } finally {
    image.close();
  }
}

export type UploadedPhoto = { id: string; width: number; height: number };

/** Uploads one shrunk photo; resolves with its id, or throws with a message worth showing. */
export async function uploadPhoto(photo: ShrunkPhoto): Promise<UploadedPhoto> {
  let res: Response;
  try {
    res = await fetch(`/api/ideas/photos?w=${photo.width}&h=${photo.height}`, {
      method: "POST",
      headers: { "Content-Type": photo.blob.type || "image/jpeg" },
      body: photo.blob,
    });
  } catch {
    throw new Error("Couldn't upload the photo. Check your connection and try again.");
  }
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("You've been signed out.");
  }
  const body = (await res.json().catch(() => null)) as (UploadedPhoto & { error?: string }) | null;
  if (!res.ok || !body?.id) throw new Error(body?.error ?? "Couldn't upload the photo. Try again.");
  return { id: body.id, width: body.width, height: body.height };
}

/** Where a stored photo is served from. */
export function photoUrl(id: string): string {
  return `/api/ideas/photos/${encodeURIComponent(id)}`;
}
