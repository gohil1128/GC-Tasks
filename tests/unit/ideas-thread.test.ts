import { describe, expect, it } from "vitest";
import {
  buildReplyTree,
  compareReplies,
  countDescendants,
  countReplies,
  indentFor,
  isIdeaSort,
  MAX_INDENT_DEPTH,
  snippet,
  sortIdeas,
} from "@/modules/ideas/thread";
import type { IdeaPost, ReplyNode } from "@/modules/ideas/types";

let n = 0;
function post(over: Partial<IdeaPost> & { id: string }): IdeaPost {
  return {
    parentId: "root",
    authorId: "u1",
    author: { id: "u1", name: "Riya", color: "rust", avatar: null },
    title: null,
    body: over.id,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, ++n)).toISOString(),
    editedAt: null,
    deleted: false,
    upvotes: 0,
    upvotedByMe: false,
    photos: [],
    ...over,
  };
}

const ids = (nodes: ReplyNode[]): unknown[] =>
  nodes.map((node) => (node.replies.length ? [node.id, ids(node.replies)] : node.id));

describe("buildReplyTree", () => {
  it("nests replies under their parents, ignoring the root itself", () => {
    const posts = [
      post({ id: "root", parentId: null, title: "Idea" }),
      post({ id: "a" }),
      post({ id: "a1", parentId: "a" }),
      post({ id: "a1x", parentId: "a1" }),
      post({ id: "b" }),
    ];
    expect(ids(buildReplyTree("root", posts))).toEqual([["a", [["a1", ["a1x"]]]], "b"]);
  });

  it("sorts siblings by upvotes, then oldest first, at every level", () => {
    const posts = [
      post({ id: "old" }),
      post({ id: "new" }),
      post({ id: "liked", upvotes: 3 }),
      post({ id: "k1", parentId: "old" }),
      post({ id: "k2", parentId: "old", upvotes: 1 }),
    ];
    expect(ids(buildReplyTree("root", posts))).toEqual(["liked", ["old", ["k2", "k1"]], "new"]);
  });

  it("keeps a deleted reply that still has live replies, and prunes one that has none", () => {
    const posts = [
      post({ id: "kept", deleted: true }),
      post({ id: "child", parentId: "kept" }),
      post({ id: "husk", deleted: true }),
      post({ id: "husk-child", parentId: "husk", deleted: true }),
    ];
    expect(ids(buildReplyTree("root", posts))).toEqual([["kept", ["child"]]]);
  });

  it("drops replies whose parent is missing, and survives a cycle", () => {
    const posts = [post({ id: "orphan", parentId: "gone" }), post({ id: "x", parentId: "y" }), post({ id: "y", parentId: "x" })];
    expect(buildReplyTree("root", posts)).toEqual([]);
  });
});

describe("counting", () => {
  it("counts live replies at every depth, and everything under a node", () => {
    const tree = buildReplyTree("root", [
      post({ id: "a", deleted: true }),
      post({ id: "a1", parentId: "a" }),
      post({ id: "a2", parentId: "a" }),
      post({ id: "b" }),
    ]);
    expect(countReplies(tree)).toBe(3);
    expect(countDescendants(tree[0])).toBe(2);
    expect(countDescendants(tree[1])).toBe(0);
  });
});

describe("sortIdeas", () => {
  const list = [
    { id: "1", upvotes: 1, createdAt: "2026-10-01T00:00:00.000Z" },
    { id: "2", upvotes: 5, createdAt: "2026-10-02T00:00:00.000Z" },
    { id: "3", upvotes: 1, createdAt: "2026-10-03T00:00:00.000Z" },
  ];

  it("Top: most upvoted, then newest", () => {
    expect(sortIdeas(list, "top").map((i) => i.id)).toEqual(["2", "3", "1"]);
  });

  it("New: newest first, whatever the votes", () => {
    expect(sortIdeas(list, "new").map((i) => i.id)).toEqual(["3", "2", "1"]);
  });

  it("does not reorder the list it was given", () => {
    sortIdeas(list, "top");
    expect(list.map((i) => i.id)).toEqual(["1", "2", "3"]);
  });
});

describe("compareReplies", () => {
  it("is most upvoted, then oldest", () => {
    const a = { id: "a", upvotes: 0, createdAt: "2026-10-01T00:00:00.000Z" };
    const b = { id: "b", upvotes: 0, createdAt: "2026-10-02T00:00:00.000Z" };
    expect(compareReplies(a, b)).toBeLessThan(0);
    expect(compareReplies({ ...b, upvotes: 1 }, a)).toBeLessThan(0);
  });
});

describe("indentFor", () => {
  it("stops indenting past the cap", () => {
    expect(indentFor(0)).toBe(0);
    expect(indentFor(2)).toBe(2);
    expect(indentFor(MAX_INDENT_DEPTH)).toBe(MAX_INDENT_DEPTH);
    expect(indentFor(MAX_INDENT_DEPTH + 6)).toBe(MAX_INDENT_DEPTH);
    expect(indentFor(-1)).toBe(0);
  });
});

describe("snippet", () => {
  it("folds whitespace and leaves short text alone", () => {
    expect(snippet("  Oat milk\n\nchai  ")).toBe("Oat milk chai");
  });

  it("cuts long text at a word, with an ellipsis", () => {
    const text = "word ".repeat(100);
    const cut = snippet(text, 42);
    expect(cut.endsWith("word…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(43);
  });

  it("cuts mid-word when there is no space near the end", () => {
    expect(snippet("x".repeat(50), 10)).toBe(`${"x".repeat(10)}…`);
  });
});

describe("isIdeaSort", () => {
  it("accepts only the two sorts", () => {
    expect(isIdeaSort("top")).toBe(true);
    expect(isIdeaSort("new")).toBe(true);
    expect(isIdeaSort("hot")).toBe(false);
    expect(isIdeaSort(undefined)).toBe(false);
  });
});
