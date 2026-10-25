/*
  The shapes the Ideas page passes between server and browser. Plain JSON —
  dates are ISO strings — and no server-only imports: client components
  import this file.

  A deleted post that is still in its thread (because it has replies) comes
  out with `deleted: true`, an empty body and no author: who wrote it and
  what it said are gone for everyone, owners included.
*/

/** A person as an idea's byline shows them; satisfies AvatarPerson. */
export type IdeaAuthor = {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
};

export const IDEA_SORTS = ["top", "new"] as const;
export type IdeaSort = (typeof IDEA_SORTS)[number];

export const IDEA_SORT_LABEL: Record<IdeaSort, string> = {
  top: "Top",
  new: "New",
};

/** One row of the /ideas list. */
export type IdeaSummary = {
  id: string;
  title: string;
  /** The start of the body, cut at a word; "" when there is none or it was deleted. */
  snippet: string;
  /** Null when deleted. */
  author: IdeaAuthor | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  upvotes: number;
  upvotedByMe: boolean;
  /** Replies at any depth that have not been deleted. */
  replyCount: number;
};

/** An idea or one reply, as the thread page shows it. */
export type IdeaPost = {
  id: string;
  /** Null for the idea itself. */
  parentId: string | null;
  /** Null when deleted. */
  authorId: string | null;
  author: IdeaAuthor | null;
  /** The idea's title; null on replies. */
  title: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  upvotes: number;
  upvotedByMe: boolean;
};

/** A reply with the replies to it, already sorted (see ./thread.ts). */
export type ReplyNode = IdeaPost & { replies: ReplyNode[] };

export type IdeaThread = {
  idea: IdeaPost;
  /** Direct replies to the idea, each carrying its own subtree. */
  replies: ReplyNode[];
  /** Replies at any depth that have not been deleted. */
  replyCount: number;
};

/** What setting a vote answers with: the post's count as it now stands. */
export type VoteResult = { id: string; upvotes: number; upvotedByMe: boolean };

/**
  What deleting answers with. `removed` is false when the post stayed in its
  thread as "[deleted]"; `ideaGone` is true when the whole idea went, so a
  page showing it should go back to the list.
*/
export type DeleteIdeaResult = { id: string; removed: boolean; ideaGone: boolean };
