import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Actor, Role } from "@/lib/permissions";
import { MAX_PHOTOS_PER_POST, readPhoto, savePhotoUpload, sniffImage } from "@/modules/ideas/photos";
import { getIdeaThread, listIdeas } from "@/modules/ideas/queries";
import * as svc from "@/modules/ideas/service";
import { editIdeaSchema, replySchema, shareIdeaSchema } from "@/modules/ideas/validation";
import type { ActionResult } from "@/modules/tasks/types";

/*
  Photos on ideas and replies, against a real Postgres: only real images are
  stored, a post can only take its author's own unattached uploads, editing
  swaps them, deleting takes them away, and who may see one. Empties every
  table, so it runs only on a test database.
*/
const RUN = (process.env.DATABASE_URL ?? "").includes("test");

// Smallest byte strings each type is recognised by.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");

let seq = 0;
async function makeUser(name: string, role: Role = "STAFF"): Promise<Actor> {
  const user = await prisma.user.create({
    data: { name, email: `${name.toLowerCase()}-${++seq}@example.test`, passwordHash: "x", role },
  });
  return { id: user.id, role };
}

function data<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.error}`);
  return result.data;
}

async function upload(actor: Actor, bytes = JPEG, w = 800, h = 600): Promise<string> {
  const r = await savePhotoUpload(actor, bytes, { width: String(w), height: String(h) });
  if (!r.ok) throw new Error(r.error);
  return r.photo.id;
}

const share = (actor: Actor, title: string, photoIds: string[] = [], body = "") =>
  svc.shareIdea(actor, shareIdeaSchema.parse({ title, body, photoIds }));
const reply = (actor: Actor, parentId: string, body: string, photoIds: string[] = []) =>
  svc.replyToIdea(actor, replySchema.parse({ parentId, body, photoIds }));
const edit = (actor: Actor, input: { id: string; title?: string; body?: string; photoIds?: string[] }) =>
  svc.editIdea(actor, editIdeaSchema.parse(input));

describe("sniffImage", () => {
  it("knows JPEG, PNG and WebP by their first bytes, and nothing else", () => {
    expect(sniffImage(JPEG)).toBe("image/jpeg");
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(WEBP)).toBe("image/webp");
    expect(sniffImage(SVG)).toBeNull();
    expect(sniffImage(HTML)).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe.skipIf(!RUN)("idea photos (integration)", () => {
  let riya: Actor;
  let sam: Actor;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE "IdeaPhoto", "IdeaVote", "Idea", "User" CASCADE`);
    riya = await makeUser("Riya");
    sam = await makeUser("Sam");
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores only real images, with their checked type, and refuses SVG and HTML", async () => {
    const id = await upload(riya, PNG);
    expect(await prisma.ideaPhoto.findUnique({ where: { id }, select: { mime: true, ideaId: true } })).toEqual({
      mime: "image/png",
      ideaId: null,
    });
    for (const bad of [SVG, HTML, new Uint8Array()]) {
      expect(await savePhotoUpload(riya, bad, { width: "10", height: "10" })).toMatchObject({ ok: false, status: 400 });
    }
    expect(await savePhotoUpload(riya, JPEG, { width: "0", height: "x" })).toMatchObject({ ok: false, status: 400 });
  });

  it("attaches photos in order when an idea is shared, and shows them on the thread and in the list", async () => {
    const a = await upload(riya, JPEG, 1600, 1200);
    const b = await upload(riya, PNG, 900, 1600);
    const idea = data(await share(riya, "New mugs", [b, a]));
    const thread = await getIdeaThread(sam.id, idea.id);
    expect(thread?.idea.photos).toEqual([
      { id: b, width: 900, height: 1600 },
      { id: a, width: 1600, height: 1200 },
    ]);
    const [summary] = await listIdeas(sam.id, "new");
    expect(summary).toMatchObject({ photoCount: 2, cover: { id: b } });
  });

  it("lets a reply be just a photo, but not nothing at all", async () => {
    const idea = data(await share(riya, "Idea"));
    const photo = await upload(sam);
    const r = data(await reply(sam, idea.id, "", [photo]));
    expect((await getIdeaThread(riya.id, idea.id))?.replies[0]).toMatchObject({ id: r.id, body: "", photos: [{ id: photo }] });
    expect(() => replySchema.parse({ parentId: idea.id, body: "  ", photoIds: [] })).toThrow();
  });

  it("refuses someone else's upload, one already on a post, and more than the limit", async () => {
    const idea = data(await share(riya, "Idea"));
    const riyas = await upload(riya);
    const result = await reply(sam, idea.id, "Look", [riyas]);
    expect(result).toMatchObject({ ok: false, code: "INVALID" });
    // Nothing was written: the reply rolled back with the refused photo.
    expect((await getIdeaThread(riya.id, idea.id))?.replies).toHaveLength(0);

    data(await share(riya, "Second", [riyas]));
    expect(await share(riya, "Third", [riyas])).toMatchObject({ ok: false, code: "INVALID" });

    const many = await Promise.all(Array.from({ length: MAX_PHOTOS_PER_POST + 1 }, () => upload(riya)));
    expect(() => shareIdeaSchema.parse({ title: "Too many", photoIds: many })).toThrow();
  });

  it("swaps photos on edit: drops the ones left out, adds new ones, and marks it edited", async () => {
    const [a, b] = [await upload(riya), await upload(riya)];
    const idea = data(await share(riya, "Idea", [a, b]));
    const c = await upload(riya);
    data(await edit(riya, { id: idea.id, photoIds: [c, a] }));
    const t = await getIdeaThread(riya.id, idea.id);
    expect(t?.idea.photos.map((p) => p.id)).toEqual([c, a]);
    expect(t?.idea.editedAt).not.toBeNull();
    expect(await prisma.ideaPhoto.findUnique({ where: { id: b } })).toBeNull();
    // A reply that is only a photo can't lose it without gaining words.
    const only = await upload(sam);
    const r = data(await reply(sam, idea.id, "", [only]));
    expect(await edit(sam, { id: r.id, photoIds: [] })).toMatchObject({ ok: false, code: "INVALID" });
    data(await edit(sam, { id: r.id, body: "Now with words", photoIds: [] }));
  });

  it("takes photos away with a deleted post, whether it is removed or kept as [deleted]", async () => {
    const a = await upload(riya);
    const idea = data(await share(riya, "Idea", [a]));
    data(await reply(sam, idea.id, "Reply"));
    data(await svc.deleteIdea(riya, idea.id)); // kept as [deleted] for its reply
    expect(await prisma.ideaPhoto.count({ where: { ideaId: idea.id } })).toBe(0);
    expect((await getIdeaThread(sam.id, idea.id))?.idea.photos).toEqual([]);

    const b = await upload(sam);
    const lone = data(await share(sam, "Lone", [b]));
    data(await svc.deleteIdea(sam, lone.id)); // removed outright
    expect(await prisma.ideaPhoto.findUnique({ where: { id: b } })).toBeNull();
  });

  it("shows a posted photo to any teammate, an unposted one only to its uploader", async () => {
    const posted = await upload(riya);
    data(await share(riya, "Idea", [posted]));
    const pending = await upload(riya);
    expect(await readPhoto(sam, posted)).toMatchObject({ mime: "image/jpeg" });
    expect(await readPhoto(riya, pending)).not.toBeNull();
    expect(await readPhoto(sam, pending)).toBeNull();
    expect(await readPhoto(sam, "nope")).toBeNull();
  });

  it("clears out a day-old upload that never made it onto a post", async () => {
    const old = await upload(riya);
    await prisma.ideaPhoto.update({ where: { id: old }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    await upload(riya);
    expect(await prisma.ideaPhoto.findUnique({ where: { id: old } })).toBeNull();
  });
});
