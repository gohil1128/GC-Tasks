import type { IdeaPost, IdeaSort, IdeaSummary, ReplyNode } from "@/modules/ideas/types";

/*
  The Ideas page's ordering and tree building, kept apart from the database
  and React so it can be tested on its own. Pure and client-safe.
*/

/**
  Past this depth a reply is drawn no further right than its parent — on a
  phone, ten levels of indent would leave a word per line. The nesting itself
  is kept; deeper replies just say who they answer.
*/
export const MAX_INDENT_DEPTH = 4;

export function indentFor(depth: number): number {
  return Math.min(Math.max(depth, 0), MAX_INDENT_DEPTH);
}

/** The list: Top is most upvoted first, then newest; New is newest first. */
export function sortIdeas<T extends Pick<IdeaSummary, "upvotes" | "createdAt" | "id">>(ideas: T[], sort: IdeaSort): T[] {
  return [...ideas].sort((a, b) => {
    if (sort === "top" && a.upvotes !== b.upvotes) return b.upvotes - a.upvotes;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id);
  });
}

/** Siblings in a thread: most upvoted first, then oldest, so a conversation reads in order. */
export function compareReplies(a: Pick<IdeaPost, "upvotes" | "createdAt" | "id">, b: typeof a): number {
  return b.upvotes - a.upvotes || Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
}

/**
  The replies under `rootId`, as a sorted tree. A reply whose parent is not in
  the list is dropped rather than promoted, and a deleted reply with nothing
  live left under it is pruned — the service removes those already, so this
  only matters for a read that raced a delete.
*/
export function buildReplyTree(rootId: string, posts: IdeaPost[]): ReplyNode[] {
  const children = new Map<string, IdeaPost[]>();
  for (const post of posts) {
    if (post.id === rootId || post.parentId === null) continue;
    const siblings = children.get(post.parentId);
    if (siblings) siblings.push(post);
    else children.set(post.parentId, [post]);
  }
  const grow = (parentId: string, seen: Set<string>): ReplyNode[] =>
    (children.get(parentId) ?? [])
      .filter((post) => !seen.has(post.id))
      .sort(compareReplies)
      .map((post) => ({ ...post, replies: grow(post.id, new Set(seen).add(post.id)) }))
      .filter((node) => !node.deleted || node.replies.length > 0);
  return grow(rootId, new Set([rootId]));
}

/** Live replies at any depth. */
export function countReplies(nodes: ReplyNode[]): number {
  return nodes.reduce((n, node) => n + (node.deleted ? 0 : 1) + countReplies(node.replies), 0);
}

/** Everything under a node, for "3 more replies" on a collapsed one. */
export function countDescendants(node: ReplyNode): number {
  return node.replies.reduce((n, child) => n + 1 + countDescendants(child), 0);
}

/** The start of a body for the list: whitespace folded, cut at a word near `max`. */
export function snippet(body: string, max = 240): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function isIdeaSort(value: unknown): value is IdeaSort {
  return value === "top" || value === "new";
}
