import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildReplyTree, countReplies, snippet, sortIdeas } from "@/modules/ideas/thread";
import type { IdeaAuthor, IdeaPost, IdeaSort, IdeaSummary, IdeaThread } from "@/modules/ideas/types";

/*
  The Ideas page's reads. Like getBoard() they trust the caller to have
  checked who is asking (the pages call requirePageUser first); `viewerId`
  only decides which posts show as upvoted by "you".

  A deleted post's author and words never leave the server: the row keeps its
  authorId (the foreign key needs one) but the DTO says null.
*/

const authorSelect = { id: true, name: true, color: true, avatar: true } satisfies Prisma.UserSelect;

function postSelect(viewerId: string) {
  return {
    id: true,
    parentId: true,
    authorId: true,
    title: true,
    body: true,
    createdAt: true,
    editedAt: true,
    deletedAt: true,
    author: { select: authorSelect },
    votes: { where: { userId: viewerId }, select: { userId: true } },
    _count: { select: { votes: true } },
  } satisfies Prisma.IdeaSelect;
}

type PostRow = Prisma.IdeaGetPayload<{ select: ReturnType<typeof postSelect> }>;

function toAuthor(row: PostRow["author"]): IdeaAuthor {
  return { id: row.id, name: row.name, color: row.color, avatar: row.avatar };
}

function toPost(row: PostRow): IdeaPost {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    parentId: row.parentId,
    authorId: deleted ? null : row.authorId,
    author: deleted ? null : toAuthor(row.author),
    title: row.title,
    body: deleted ? "" : row.body,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deleted,
    upvotes: row._count.votes,
    upvotedByMe: row.votes.length > 0,
  };
}

/**
  Every idea, in the order asked for. Sorted here rather than by the
  database so Top and New share one tested comparator (./thread.ts); a
  café team's ideas are a list, not a feed.
*/
export async function listIdeas(viewerId: string, sort: IdeaSort): Promise<IdeaSummary[]> {
  const select = postSelect(viewerId);
  const rows = await prisma.idea.findMany({
    where: { parentId: null },
    select: { ...select, _count: { select: { votes: true, thread: { where: { deletedAt: null } } } } },
  });
  return sortIdeas(
    rows.map((row) => {
      const post = toPost(row);
      return {
        id: post.id,
        title: post.title ?? "",
        snippet: snippet(post.body),
        author: post.author,
        createdAt: post.createdAt,
        editedAt: post.editedAt,
        deleted: post.deleted,
        upvotes: post.upvotes,
        upvotedByMe: post.upvotedByMe,
        replyCount: row._count.thread,
      };
    }),
    sort,
  );
}

/** One idea and every reply under it, as a sorted tree; null if there is no such idea. */
export async function getIdeaThread(viewerId: string, id: string): Promise<IdeaThread | null> {
  const rows = await prisma.idea.findMany({
    where: { OR: [{ id, parentId: null }, { rootId: id }] },
    select: postSelect(viewerId),
  });
  const root = rows.find((row) => row.id === id);
  if (!root) return null;
  const replies = buildReplyTree(id, rows.map(toPost));
  return { idea: toPost(root), replies, replyCount: countReplies(replies) };
}
