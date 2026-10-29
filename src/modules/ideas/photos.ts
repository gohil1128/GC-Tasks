import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/permissions";
import { MAX_PHOTOS_PER_POST } from "@/modules/ideas/limits";
import { refuse } from "@/modules/tasks/revision";

/*
  Photos on ideas and replies.

  The browser shrinks a photo before it leaves the phone (see
  src/components/ideas/photo-upload.ts), uploads it on its own the moment it
  is picked, and gets an id back. Sharing, replying or editing then names the
  ids to attach, and the same transaction that writes the post claims them —
  only the uploader's own, only ones not already on a post — so a photo can
  never be lifted onto someone else's post or moved between posts.

  What comes in is checked by its first bytes (JPEG, PNG or WebP), never by
  the type the browser claims, and served back with that type and nosniff, so
  an upload cannot turn into a page in the app's origin. Photos are for
  signed-in teammates only, like the ideas themselves.

  Storage is the database: a team's ideas, a few hundred KB a photo. An upload
  that never makes it onto a post (the dialog was closed) is removed after a
  day, the next time that person uploads.
*/

export { MAX_PHOTOS_PER_POST };
/** After shrinking on the phone a photo is a few hundred KB; this is a generous ceiling. */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const MAX_PENDING_PER_PERSON = 24;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SIDE = 10_000;

export type PhotoMime = "image/jpeg" | "image/png" | "image/webp";

/** The image type its first bytes say it is, or null for anything else (including SVG and HTML). */
export function sniffImage(bytes: Uint8Array): PhotoMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function side(value: unknown): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : typeof value === "number" ? value : NaN;
  return Number.isInteger(n) && n >= 1 && n <= MAX_SIDE ? n : 0;
}

export type UploadResult =
  | { ok: true; photo: { id: string; width: number; height: number } }
  | { ok: false; status: 400 | 413 | 429; error: string };

/** Stores one upload for `actor`, not yet on any post. Width and height are only used to lay photos out. */
export async function savePhotoUpload(
  actor: Actor,
  bytes: Uint8Array,
  size: { width: unknown; height: unknown },
): Promise<UploadResult> {
  if (bytes.length === 0) return { ok: false, status: 400, error: "That photo was empty." };
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, status: 413, error: "That photo is too large." };
  const mime = sniffImage(bytes);
  if (!mime) return { ok: false, status: 400, error: "That isn't a photo the app can show (JPEG, PNG or WebP)." };
  const width = side(size.width);
  const height = side(size.height);
  if (!width || !height) return { ok: false, status: 400, error: "That photo's size is missing." };

  // Yesterday's abandoned uploads go first; then a cap, so one person cannot fill the database.
  await prisma.ideaPhoto.deleteMany({
    where: { uploaderId: actor.id, ideaId: null, createdAt: { lt: new Date(Date.now() - PENDING_TTL_MS) } },
  });
  const pending = await prisma.ideaPhoto.count({ where: { uploaderId: actor.id, ideaId: null } });
  if (pending >= MAX_PENDING_PER_PERSON) {
    return { ok: false, status: 429, error: "Too many photos waiting to be posted. Post or remove some first." };
  }

  const photo = await prisma.ideaPhoto.create({
    data: { uploaderId: actor.id, mime, width, height, size: bytes.length, bytes: Buffer.from(bytes) },
    select: { id: true, width: true, height: true },
  });
  return { ok: true, photo };
}

/**
  The photo's bytes for a signed-in viewer: any photo on a post that has not
  been deleted, or the viewer's own upload that is not on a post yet.
*/
export async function readPhoto(viewer: Actor, id: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  if (!id || id.length > 64) return null;
  const photo = await prisma.ideaPhoto.findUnique({
    where: { id },
    select: { mime: true, bytes: true, uploaderId: true, ideaId: true, idea: { select: { deletedAt: true } } },
  });
  if (!photo) return null;
  const visible = photo.ideaId ? photo.idea?.deletedAt === null : photo.uploaderId === viewer.id;
  return visible ? { mime: photo.mime, bytes: photo.bytes } : null;
}

type Tx = Prisma.TransactionClient;

const MSG = {
  tooMany: `Up to ${MAX_PHOTOS_PER_POST} photos on a post.`,
  missing: "A photo didn't finish uploading, or was already used. Remove it and add it again.",
} as const;

/**
  Makes `photoIds`, in that order, the photos on `ideaId`. New ones must be
  the actor's own uploads not yet on a post; ones already on this post may
  stay or be reordered; any of the post's photos left out are deleted.
  Returns whether anything changed.
*/
export async function setPostPhotos(tx: Tx, actorId: string, ideaId: string, photoIds: string[]): Promise<boolean> {
  const ids = [...new Set(photoIds)];
  if (ids.length > MAX_PHOTOS_PER_POST) refuse("INVALID", MSG.tooMany);

  const current = await tx.ideaPhoto.findMany({
    where: { ideaId },
    select: { id: true, position: true },
    orderBy: { position: "asc" },
  });
  const currentIds = current.map((p) => p.id);
  const fresh = ids.filter((id) => !currentIds.includes(id));
  if (fresh.length > 0) {
    const claimable = await tx.ideaPhoto.count({ where: { id: { in: fresh }, uploaderId: actorId, ideaId: null } });
    if (claimable !== fresh.length) refuse("INVALID", MSG.missing);
  }

  const dropped = currentIds.filter((id) => !ids.includes(id));
  const sameOrder = dropped.length === 0 && fresh.length === 0 && ids.every((id, i) => currentIds[i] === id);
  if (sameOrder) return false;

  if (dropped.length > 0) await tx.ideaPhoto.deleteMany({ where: { id: { in: dropped }, ideaId } });
  for (const [position, id] of ids.entries()) {
    // Claimed only while still unattached (or already ours here): a race to reuse an upload loses cleanly.
    const claimed = await tx.ideaPhoto.updateMany({
      where: { id, OR: [{ ideaId }, { ideaId: null, uploaderId: actorId }] },
      data: { ideaId, position },
    });
    if (claimed.count !== 1) refuse("INVALID", MSG.missing);
  }
  return true;
}

/** How many photos a post has right now. */
export async function countPostPhotos(tx: Tx, ideaId: string): Promise<number> {
  return tx.ideaPhoto.count({ where: { ideaId } });
}

/** A post deleted but kept as "[deleted]" for its replies loses its photos with its words. */
export async function wipePostPhotos(tx: Tx, ideaId: string): Promise<void> {
  await tx.ideaPhoto.deleteMany({ where: { ideaId } });
}
