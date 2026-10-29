import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  canDeleteIdea,
  canEditIdea,
  canReplyToIdea,
  canShareIdea,
  canVoteIdea,
  type Actor,
  type IdeaAccess,
} from "@/lib/permissions";
import { asFailure, readRevision, refuse } from "@/modules/tasks/revision";
import type { ActionResult } from "@/modules/tasks/types";
import { countPostPhotos, setPostPhotos, wipePostPhotos } from "@/modules/ideas/photos";
import type { DeleteIdeaResult, VoteResult } from "@/modules/ideas/types";
import type { EditIdeaData, ReplyData, ShareIdeaData, VoteData } from "@/modules/ideas/validation";

/*
  The Ideas page's writes: sharing an idea, replying anywhere in its thread,
  upvoting, editing and deleting. Like the board's services these take an
  Actor and already-validated input, return an ActionResult, and never throw
  for an expected refusal; the Server Actions in ./actions.ts are thin
  wrappers and the integration tests call these directly.

  Nothing here is a board write. Ideas do not take the board lock or move the
  board revision, so a busy thread never sends every open board to refetch;
  the revision in each result is simply the board's as it stands.

  Each write is one transaction that:
    - re-reads the acting person and holds their row (FOR SHARE), so a
      deactivation that commits first refuses the write, and one that comes
      after has to wait for it to finish rather than slip in between;
    - takes the thread's own lock (one per idea, its replies included), so
      a reply cannot land under a post in the same moment it is removed for
      having no replies, and a delete cannot miss a vote or edit in flight;
    - re-reads the post under that lock and checks permissions against it.

  Deleting keeps threads whole, Reddit-style: a post that still has replies
  stays in place with its body wiped and its author hidden ("[deleted]"); a
  post with none is removed outright, and so is any deleted parent that is
  left with nothing under it. An idea keeps its title when deleted, so the
  thread below it still makes sense.
*/

type Tx = Prisma.TransactionClient;

/** Arbitrary, but fixed, and not the team's: the first half of every thread lock's key. */
const THREAD_LOCK_SPACE = 4_431_007;

const MSG = {
  gone: "That idea or reply no longer exists. Someone may have deleted it.",
  deleted: "That has been deleted.",
  inactive: "Your account is no longer active.",
  clashed: "Someone else changed this thread at the same moment. Try again.",
  noTitleOnReply: "Replies don't have a title.",
  emptyReply: "A reply needs some words or a photo. Delete it instead if you want it gone.",
} as const;

/** The acting person as they stand now, their row held until the write commits. */
async function freshActor(tx: Tx, actor: Actor): Promise<Actor> {
  const [row] = await tx.$queryRaw<{ role: Actor["role"]; active: boolean }[]>`
    SELECT "role", "active" FROM "User" WHERE "id" = ${actor.id} FOR SHARE`;
  if (!row || !row.active) refuse("UNAUTHORIZED", MSG.inactive);
  return { id: actor.id, role: row.role };
}

/**
  Runs `work` as one Ideas write. A board-wide clash comes back as INVALID
  rather than CONFLICT, because runAction() leaves CONFLICT to the caller to
  show and nothing on the Ideas page does: the tap would fail in silence.
*/
async function ideaWrite<T>(actor: Actor, work: (tx: Tx, actor: Actor) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await prisma.$transaction(async (tx) => work(tx, await freshActor(tx, actor)), {
      maxWait: 5_000,
      timeout: 15_000,
    });
    return { ok: true, data, revision: await readRevision() };
  } catch (err) {
    // A post that vanished between the read and a vote or reply pointing at it.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return { ok: false, code: "NOT_FOUND", error: MSG.gone };
    }
    const failure = asFailure(err);
    if (failure?.code === "CONFLICT") return { ok: false, code: "INVALID", error: MSG.clashed };
    if (failure) return failure;
    throw err;
  }
}

const postSelect = {
  id: true,
  parentId: true,
  rootId: true,
  authorId: true,
  deletedAt: true,
  title: true,
  body: true,
} satisfies Prisma.IdeaSelect;

type PostRow = Prisma.IdeaGetPayload<{ select: typeof postSelect }>;

function access(post: PostRow): IdeaAccess {
  return { authorId: post.authorId, deleted: post.deletedAt !== null };
}

/**
  The post, read again once its thread's lock is held. The first read only
  finds which thread to lock; anything decided is decided on the second.
*/
async function lockedPost(tx: Tx, id: string): Promise<PostRow> {
  const first = await tx.idea.findUnique({ where: { id }, select: { id: true, rootId: true } });
  if (!first) refuse("NOT_FOUND", MSG.gone);
  const rootId = first.rootId ?? first.id;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${THREAD_LOCK_SPACE}::int, hashtext(${rootId}))`;
  const post = await tx.idea.findUnique({ where: { id }, select: postSelect });
  if (!post) refuse("NOT_FOUND", MSG.gone);
  return post;
}

async function voteCount(tx: Tx, id: string): Promise<number> {
  return tx.ideaVote.count({ where: { ideaId: id } });
}

// ── Writes ───────────────────────────────────────────────────────────────

export async function shareIdea(actor: Actor, input: ShareIdeaData): Promise<ActionResult<{ id: string }>> {
  return ideaWrite(actor, async (tx, actor) => {
    if (!canShareIdea(actor)) refuse("FORBIDDEN", "You can't share ideas.");
    const idea = await tx.idea.create({
      data: { authorId: actor.id, title: input.title, body: input.body },
      select: { id: true },
    });
    if (input.photoIds.length > 0) await setPostPhotos(tx, actor.id, idea.id, input.photoIds);
    return { id: idea.id };
  });
}

/** A reply to the idea itself or to any reply in its thread, however deep. */
export async function replyToIdea(
  actor: Actor,
  input: ReplyData,
): Promise<ActionResult<{ id: string; rootId: string }>> {
  return ideaWrite(actor, async (tx, actor) => {
    const parent = await lockedPost(tx, input.parentId);
    if (parent.deletedAt) refuse("INVALID", "You can't reply to something that has been deleted.");
    if (!canReplyToIdea(actor, access(parent))) refuse("FORBIDDEN", "You can't reply here.");
    const rootId = parent.rootId ?? parent.id;
    const reply = await tx.idea.create({
      data: { authorId: actor.id, parentId: parent.id, rootId, body: input.body },
      select: { id: true },
    });
    if (input.photoIds.length > 0) await setPostPhotos(tx, actor.id, reply.id, input.photoIds);
    return { id: reply.id, rootId };
  });
}

/** The author only. A title is an idea's alone, and a reply cannot be emptied. */
export async function editIdea(actor: Actor, input: EditIdeaData): Promise<ActionResult<{ id: string }>> {
  return ideaWrite(actor, async (tx, actor) => {
    const post = await lockedPost(tx, input.id);
    if (post.deletedAt) refuse("INVALID", MSG.deleted);
    if (!canEditIdea(actor, access(post))) refuse("FORBIDDEN", "You can only edit what you wrote.");
    const isReply = post.parentId !== null;
    if (isReply && input.title !== undefined) refuse("INVALID", MSG.noTitleOnReply);
    const retitle = input.title !== undefined && input.title !== post.title;
    const reword = input.body !== undefined && input.body !== post.body;
    const rephoto = input.photoIds !== undefined && (await setPostPhotos(tx, actor.id, post.id, input.photoIds));
    // A reply has to keep something in it: words or a photo.
    if (isReply && (input.body ?? post.body) === "" && (await countPostPhotos(tx, post.id)) === 0) {
      refuse("INVALID", MSG.emptyReply);
    }
    if (!retitle && !reword && !rephoto) return { id: post.id };
    await tx.idea.update({
      where: { id: post.id },
      data: {
        ...(retitle ? { title: input.title } : {}),
        ...(reword ? { body: input.body } : {}),
        editedAt: new Date(),
      },
      select: { id: true },
    });
    return { id: post.id };
  });
}

/**
  Your own, or anyone's if you are an owner. With replies under it the post
  stays as "[deleted]"; without, it goes, and so does each deleted parent
  above it that this leaves empty — up to the idea itself.
*/
export async function deleteIdea(actor: Actor, id: string): Promise<ActionResult<DeleteIdeaResult>> {
  return ideaWrite(actor, async (tx, actor) => {
    const post = await lockedPost(tx, id);
    if (post.deletedAt) refuse("INVALID", MSG.deleted);
    if (!canDeleteIdea(actor, access(post))) refuse("FORBIDDEN", "You can only delete what you wrote.");

    if ((await tx.idea.count({ where: { parentId: post.id } })) > 0) {
      await tx.idea.update({
        where: { id: post.id },
        data: { deletedAt: new Date(), body: "" },
        select: { id: true },
      });
      // Its photos go with its words; the post stays only to hold its replies' place.
      await wipePostPhotos(tx, post.id);
      return { id: post.id, removed: false, ideaGone: false };
    }

    await tx.idea.delete({ where: { id: post.id }, select: { id: true } });
    let ideaGone = post.parentId === null;
    let parentId = post.parentId;
    while (parentId) {
      const parent = await tx.idea.findUnique({
        where: { id: parentId },
        select: { id: true, parentId: true, deletedAt: true, _count: { select: { replies: true } } },
      });
      if (!parent || !parent.deletedAt || parent._count.replies > 0) break;
      await tx.idea.delete({ where: { id: parent.id }, select: { id: true } });
      ideaGone = parent.parentId === null;
      parentId = parent.parentId;
    }
    return { id: post.id, removed: true, ideaGone };
  });
}

/**
  Sets this person's upvote on a post to `up`. Saying the same thing twice
  is harmless — the vote's key makes a second row impossible — and the answer
  is always the count as it now stands.
*/
export async function setVote(actor: Actor, input: VoteData): Promise<ActionResult<VoteResult>> {
  return ideaWrite(actor, async (tx, actor) => {
    const post = await lockedPost(tx, input.id);
    if (input.up) {
      if (post.deletedAt) refuse("INVALID", MSG.deleted);
      if (!canVoteIdea(actor, access(post))) refuse("FORBIDDEN", "You can't upvote your own post.");
      await tx.ideaVote.createMany({ data: [{ ideaId: post.id, userId: actor.id }], skipDuplicates: true });
    } else {
      // Taking a vote back is always allowed, even off a post deleted since.
      await tx.ideaVote.deleteMany({ where: { ideaId: post.id, userId: actor.id } });
    }
    return { id: post.id, upvotes: await voteCount(tx, post.id), upvotedByMe: input.up };
  });
}
