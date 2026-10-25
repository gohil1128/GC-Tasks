import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Actor, Role } from "@/lib/permissions";
import { getIdeaThread, listIdeas } from "@/modules/ideas/queries";
import * as svc from "@/modules/ideas/service";
import type { ReplyNode } from "@/modules/ideas/types";
import { editIdeaSchema, replySchema, shareIdeaSchema, voteSchema } from "@/modules/ideas/validation";
import type { ActionResult } from "@/modules/tasks/types";

/*
  The Ideas service against a real Postgres: threads, votes, who may edit
  and delete, and deleting without tearing a thread apart. Every table is
  emptied before each test, so this only runs when DATABASE_URL looks like a
  test database.
*/
const RUN = (process.env.DATABASE_URL ?? "").includes("test");

// ── Helpers ────────────────────────────────────────────────────────────────

async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "IdeaVote", "Idea", "Activity", "Comment", "ChecklistItem", "TaskLabel", "TaskAssignee", "Task", "Label", "User", "BoardRevision", "LoginAttempt" CASCADE`,
  );
}

let seq = 0;
async function makeUser(name: string, role: Role = "STAFF", active = true): Promise<Actor> {
  const user = await prisma.user.create({
    data: { name, email: `${name.toLowerCase()}-${++seq}@example.test`, passwordHash: "x", role, active },
  });
  return { id: user.id, role };
}

function data<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.error}`);
  return result.data;
}

function refused<T>(result: ActionResult<T>, code: string) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.code).toBe(code);
  return result;
}

const share = (actor: Actor, title: string, body = "") => svc.shareIdea(actor, shareIdeaSchema.parse({ title, body }));
const reply = (actor: Actor, parentId: string, body: string) =>
  svc.replyToIdea(actor, replySchema.parse({ parentId, body }));
const edit = (actor: Actor, input: { id: string; title?: string; body?: string }) =>
  svc.editIdea(actor, editIdeaSchema.parse(input));
const vote = (actor: Actor, id: string, up = true) => svc.setVote(actor, voteSchema.parse({ id, up }));

async function thread(viewer: Actor, id: string) {
  const t = await getIdeaThread(viewer.id, id);
  if (!t) throw new Error(`idea ${id} not found`);
  return t;
}

/** A tree as nested [body, children] pairs, for readable assertions. */
function shape(nodes: ReplyNode[]): unknown[] {
  return nodes.map((n) => (n.replies.length ? [n.deleted ? "[deleted]" : n.body, shape(n.replies)] : n.deleted ? "[deleted]" : n.body));
}

describe.skipIf(!RUN)("ideas (integration)", () => {
  let owner: Actor;
  let riya: Actor;
  let sam: Actor;

  beforeEach(async () => {
    await resetDatabase();
    owner = await makeUser("Owner", "OWNER");
    riya = await makeUser("Riya");
    sam = await makeUser("Sam");
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── Threads ──────────────────────────────────────────────────────────────

  it("shares an idea, takes replies and replies to replies, and reads them back as a tree", async () => {
    const idea = data(await share(riya, "  Oat milk chai  ", "Customers keep asking for it."));
    const first = data(await reply(sam, idea.id, "Yes please"));
    const nested = data(await reply(owner, first.id, "Let's trial it next week"));
    const deeper = data(await reply(riya, nested.id, "I'll price it up"));
    expect(nested.rootId).toBe(idea.id);
    expect(deeper.rootId).toBe(idea.id);

    const t = await thread(sam, idea.id);
    expect(t.idea).toMatchObject({ title: "Oat milk chai", body: "Customers keep asking for it.", parentId: null });
    expect(t.idea.author?.name).toBe("Riya");
    expect(t.replyCount).toBe(3);
    expect(shape(t.replies)).toEqual([["Yes please", [["Let's trial it next week", ["I'll price it up"]]]]]);

    const [summary] = await listIdeas(sam.id, "new");
    expect(summary).toMatchObject({ id: idea.id, title: "Oat milk chai", replyCount: 3, upvotes: 0 });
    expect(summary.snippet).toBe("Customers keep asking for it.");
  });

  it("refuses a reply to nothing, and a thread read for a reply id", async () => {
    const idea = data(await share(riya, "Idea"));
    const r = data(await reply(sam, idea.id, "Reply"));
    refused(await reply(sam, "no-such-post", "Hello"), "NOT_FOUND");
    expect(await getIdeaThread(sam.id, r.id)).toBeNull();
  });

  it("sorts sibling replies by upvotes, then oldest first", async () => {
    const idea = data(await share(riya, "Idea"));
    const a = data(await reply(sam, idea.id, "A"));
    const b = data(await reply(sam, idea.id, "B"));
    data(await reply(sam, idea.id, "C"));
    data(await vote(riya, b.id));
    expect(shape((await thread(riya, idea.id)).replies)).toEqual(["B", "A", "C"]);
    data(await vote(owner, a.id));
    data(await vote(riya, a.id));
    expect(shape((await thread(riya, idea.id)).replies)).toEqual(["A", "B", "C"]);
  });

  it("lists ideas by Top (upvotes, then newest) or New", async () => {
    const old = data(await share(riya, "Old"));
    const popular = data(await share(sam, "Popular"));
    const fresh = data(await share(riya, "Fresh"));
    data(await vote(owner, popular.id));
    data(await vote(riya, popular.id));
    data(await vote(owner, old.id));
    const titles = async (sort: "top" | "new") => (await listIdeas(owner.id, sort)).map((i) => i.id);
    expect(await titles("top")).toEqual([popular.id, old.id, fresh.id]);
    expect(await titles("new")).toEqual([fresh.id, popular.id, old.id]);
  });

  // ── Votes ────────────────────────────────────────────────────────────────

  it("counts one upvote per person, takes it back, and never double-counts", async () => {
    const idea = data(await share(riya, "Idea"));
    expect(data(await vote(sam, idea.id))).toEqual({ id: idea.id, upvotes: 1, upvotedByMe: true });
    expect(data(await vote(sam, idea.id))).toEqual({ id: idea.id, upvotes: 1, upvotedByMe: true });
    await Promise.all([vote(owner, idea.id), vote(owner, idea.id)]);
    expect(await prisma.ideaVote.count({ where: { ideaId: idea.id } })).toBe(2);

    const [mine] = await listIdeas(sam.id, "top");
    expect(mine).toMatchObject({ upvotes: 2, upvotedByMe: true });
    const [theirs] = await listIdeas(riya.id, "top");
    expect(theirs).toMatchObject({ upvotes: 2, upvotedByMe: false });

    expect(data(await vote(sam, idea.id, false))).toEqual({ id: idea.id, upvotes: 1, upvotedByMe: false });
    expect(data(await vote(sam, idea.id, false))).toEqual({ id: idea.id, upvotes: 1, upvotedByMe: false });
  });

  it("refuses a vote on your own idea or reply", async () => {
    const idea = data(await share(riya, "Idea"));
    const r = data(await reply(sam, idea.id, "Mine"));
    refused(await vote(riya, idea.id), "FORBIDDEN");
    refused(await vote(sam, r.id), "FORBIDDEN");
    expect(await prisma.ideaVote.count()).toBe(0);
  });

  // ── Editing ──────────────────────────────────────────────────────────────

  it("lets the author edit their own idea and reply, and marks them edited", async () => {
    const idea = data(await share(riya, "Idea", "First thought"));
    const r = data(await reply(riya, idea.id, "typo"));
    data(await edit(riya, { id: idea.id, title: "Better idea", body: "" }));
    data(await edit(riya, { id: r.id, body: "fixed" }));
    const t = await thread(riya, idea.id);
    expect(t.idea).toMatchObject({ title: "Better idea", body: "" });
    expect(t.idea.editedAt).not.toBeNull();
    expect(t.replies[0]).toMatchObject({ body: "fixed" });
    expect(t.replies[0].editedAt).not.toBeNull();
  });

  it("leaves an unchanged edit unstamped, and refuses a title on a reply or an empty reply", async () => {
    const idea = data(await share(riya, "Idea", "Body"));
    const r = data(await reply(riya, idea.id, "Words"));
    data(await edit(riya, { id: idea.id, body: "Body" }));
    expect((await thread(riya, idea.id)).idea.editedAt).toBeNull();
    refused(await edit(riya, { id: r.id, title: "No" }), "INVALID");
    refused(await edit(riya, { id: r.id, body: "  " }), "INVALID");
  });

  it("refuses staff — and owners — editing someone else's words", async () => {
    const idea = data(await share(riya, "Idea"));
    const r = data(await reply(riya, idea.id, "Reply"));
    refused(await edit(sam, { id: idea.id, title: "Hijacked" }), "FORBIDDEN");
    refused(await edit(sam, { id: r.id, body: "Hijacked" }), "FORBIDDEN");
    refused(await edit(owner, { id: r.id, body: "Hijacked" }), "FORBIDDEN");
    expect((await thread(riya, idea.id)).idea.title).toBe("Idea");
  });

  // ── Deleting ─────────────────────────────────────────────────────────────

  it("removes your own post outright when nothing replies to it", async () => {
    const idea = data(await share(riya, "Idea"));
    const r = data(await reply(sam, idea.id, "Reply"));
    expect(data(await svc.deleteIdea(sam, r.id))).toEqual({ id: r.id, removed: true, ideaGone: false });
    expect(data(await svc.deleteIdea(riya, idea.id))).toEqual({ id: idea.id, removed: true, ideaGone: true });
    expect(await prisma.idea.count()).toBe(0);
  });

  it("refuses staff deleting someone else's post, but lets an owner delete anyone's", async () => {
    const idea = data(await share(riya, "Idea"));
    const r = data(await reply(riya, idea.id, "Reply"));
    refused(await svc.deleteIdea(sam, r.id), "FORBIDDEN");
    refused(await svc.deleteIdea(sam, idea.id), "FORBIDDEN");
    data(await svc.deleteIdea(owner, r.id));
    data(await svc.deleteIdea(owner, idea.id));
    expect(await prisma.idea.count()).toBe(0);
  });

  it("keeps a thread whole: a deleted post with replies reads [deleted], with no author or words", async () => {
    const idea = data(await share(riya, "Idea", "The idea"));
    const middle = data(await reply(sam, idea.id, "Middle"));
    data(await reply(owner, middle.id, "Under the middle"));
    data(await vote(riya, middle.id));
    data(await edit(sam, { id: middle.id, body: "Middle, edited" }));

    expect(data(await svc.deleteIdea(sam, middle.id))).toMatchObject({ removed: false });
    expect(data(await svc.deleteIdea(riya, idea.id))).toMatchObject({ removed: false, ideaGone: false });

    const t = await thread(owner, idea.id);
    expect(t.idea).toMatchObject({ deleted: true, author: null, authorId: null, body: "", title: "Idea", editedAt: null });
    expect(t.replies[0]).toMatchObject({ deleted: true, author: null, authorId: null, body: "", editedAt: null });
    expect(shape(t.replies)).toEqual([["[deleted]", ["Under the middle"]]]);
    expect(t.replyCount).toBe(1);
    // The words are gone from the database too, not merely hidden.
    expect((await prisma.idea.findUniqueOrThrow({ where: { id: middle.id } })).body).toBe("");

    const [summary] = await listIdeas(owner.id, "new");
    expect(summary).toMatchObject({ deleted: true, author: null, snippet: "", replyCount: 1 });

    // Nothing more can be done to a deleted post.
    refused(await reply(owner, middle.id, "Hello?"), "INVALID");
    refused(await edit(sam, { id: middle.id, body: "Back" }), "INVALID");
    refused(await vote(owner, middle.id), "INVALID");
    refused(await svc.deleteIdea(owner, middle.id), "INVALID");
    // ...but a vote cast before can still be taken back.
    expect(data(await vote(riya, middle.id, false))).toMatchObject({ upvotes: 0 });
  });

  it("clears away deleted parents once their last reply goes", async () => {
    const idea = data(await share(riya, "Idea"));
    const a = data(await reply(sam, idea.id, "A"));
    const b = data(await reply(sam, a.id, "B"));
    const c = data(await reply(owner, b.id, "C"));
    data(await svc.deleteIdea(sam, a.id));
    data(await svc.deleteIdea(sam, b.id));
    data(await svc.deleteIdea(riya, idea.id));
    expect(await prisma.idea.count()).toBe(4);

    // C was the last live post: removing it takes B, A and the idea with it.
    expect(data(await svc.deleteIdea(owner, c.id))).toEqual({ id: c.id, removed: true, ideaGone: true });
    expect(await prisma.idea.count()).toBe(0);
  });

  // ── Who may write at all ────────────────────────────────────────────────

  it("refuses every write from a deactivated account", async () => {
    const idea = data(await share(riya, "Idea"));
    const gone = await makeUser("Gone");
    const r = data(await reply(gone, idea.id, "Before"));
    await prisma.user.update({ where: { id: gone.id }, data: { active: false } });

    refused(await share(gone, "After"), "UNAUTHORIZED");
    refused(await reply(gone, idea.id, "After"), "UNAUTHORIZED");
    refused(await vote(gone, idea.id), "UNAUTHORIZED");
    refused(await edit(gone, { id: r.id, body: "After" }), "UNAUTHORIZED");
    refused(await svc.deleteIdea(gone, r.id), "UNAUTHORIZED");
    expect(await prisma.idea.count()).toBe(2);
  });

  it("re-reads the role: an owner demoted since signing in can no longer delete others' posts", async () => {
    const idea = data(await share(riya, "Idea"));
    await prisma.user.update({ where: { id: owner.id }, data: { role: "STAFF" } });
    refused(await svc.deleteIdea(owner, idea.id), "FORBIDDEN");
  });

  it("does not move the board revision", async () => {
    await prisma.boardRevision.create({ data: { id: 1, revision: 7 } });
    const result = await share(riya, "Idea");
    expect(result).toMatchObject({ ok: true, revision: 7 });
    expect((await prisma.boardRevision.findUniqueOrThrow({ where: { id: 1 } })).revision).toBe(7);
  });
});
