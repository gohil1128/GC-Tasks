import { describe, expect, it } from "vitest";
import {
  ME,
  NOBODY,
  NO_FILTERS,
  liveFilters,
  TEMP_PREFIX,
  columnsOf,
  filterTasks,
  findColumn,
  hasFilters,
  isTempId,
  landedBetween,
  moveToColumn,
  moveToTop,
  neighboursFor,
  optimisticPosition,
  placeAmongVisible,
  removeTask,
  sortTasks,
  upsertTask,
  type BoardFilters,
  type Columns,
} from "@/components/board/board-logic";
import { POSITION_STEP } from "@/modules/tasks/position";
import type { LabelDTO, TaskCard } from "@/modules/tasks/types";

function card(id: string, patch: Partial<TaskCard> = {}): TaskCard {
  return {
    id,
    title: id,
    description: "",
    status: "TODO",
    position: 1024,
    priority: "MEDIUM",
    dueDate: null,
    version: 1,
    completedAt: null,
    archivedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    createdById: "owner",
    updatedById: "owner",
    assigneeIds: [],
    labelIds: [],
    checklistDone: 0,
    checklistTotal: 0,
    commentCount: 0,
    ...patch,
  };
}

const filters = (patch: Partial<BoardFilters>): BoardFilters => ({ ...NO_FILTERS, ...patch });

const labels: LabelDTO[] = [
  { id: "l-kitchen", name: "Kitchen", color: "amber" },
  { id: "l-front", name: "Front of house", color: "blue" },
];

describe("ordering", () => {
  it("sorts by column, then position, then id", () => {
    const tasks = [
      card("d", { status: "DONE", position: 1 }),
      card("b", { status: "TODO", position: 2048 }),
      card("p", { status: "IN_PROGRESS", position: 0 }),
      card("a2", { status: "TODO", position: 1024 }),
      card("a1", { status: "TODO", position: 1024 }),
    ];
    expect(sortTasks(tasks).map((t) => t.id)).toEqual(["a1", "a2", "b", "p", "d"]);
  });

  it("does not sort in place", () => {
    const tasks = [card("b", { position: 2 }), card("a", { position: 1 })];
    sortTasks(tasks);
    expect(tasks.map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("upserts a card into its sorted place, replacing any old copy", () => {
    const tasks = [card("a", { position: 1 }), card("b", { position: 2 })];
    const moved = upsertTask(tasks, card("a", { position: 3, title: "renamed" }));
    expect(moved.map((t) => t.id)).toEqual(["b", "a"]);
    expect(moved.find((t) => t.id === "a")?.title).toBe("renamed");
    expect(upsertTask(tasks, card("c", { status: "DONE" })).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("removes a card by id", () => {
    expect(removeTask([card("a"), card("b")], "a").map((t) => t.id)).toEqual(["b"]);
    expect(removeTask([card("a")], "missing").map((t) => t.id)).toEqual(["a"]);
  });

  it("splits the board into columns in board order", () => {
    const columns = columnsOf([
      card("t2", { position: 2 }),
      card("x", { status: "DONE" }),
      card("t1", { position: 1 }),
    ]);
    expect(columns).toEqual({ TODO: ["t1", "t2"], IN_PROGRESS: [], DONE: ["x"] });
    expect(findColumn(columns, "x")).toBe("DONE");
    expect(findColumn(columns, "nope")).toBeNull();
  });
});

describe("filterTasks", () => {
  const ctx = { currentUserId: "me-id", labels };
  const tasks = [
    card("milk", { title: "Order milk", labelIds: ["l-kitchen"], assigneeIds: ["me-id"], priority: "HIGH" }),
    card("menu", { title: "Print menus", description: "New autumn chai list", labelIds: ["l-front"] }),
    card("till", { title: "Fix the till", assigneeIds: ["riya"], priority: "URGENT" }),
    card("mop", { title: "Mop floors", assigneeIds: ["riya", "me-id"], priority: "LOW" }),
  ];
  const ids = (f: BoardFilters) => filterTasks(tasks, f, ctx).map((t) => t.id);

  it("returns everything, as a copy, with no filters", () => {
    const out = filterTasks(tasks, NO_FILTERS, ctx);
    expect(out).toEqual(tasks);
    expect(out).not.toBe(tasks);
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters(filters({ query: "   " }))).toBe(false);
  });

  it("searches title, description and label names, every word anywhere, ignoring case", () => {
    expect(ids(filters({ query: "MILK" }))).toEqual(["milk"]);
    expect(ids(filters({ query: "autumn" }))).toEqual(["menu"]);
    expect(ids(filters({ query: "kitchen" }))).toEqual(["milk"]);
    expect(ids(filters({ query: "milk kitchen" }))).toEqual(["milk"]);
    expect(ids(filters({ query: "milk front" }))).toEqual([]);
    expect(hasFilters(filters({ query: "milk" }))).toBe(true);
  });

  it("treats ME as the viewer and NOBODY as unassigned", () => {
    expect(ids(filters({ people: [ME] }))).toEqual(["milk", "mop"]);
    expect(ids(filters({ people: [NOBODY] }))).toEqual(["menu"]);
    expect(ids(filters({ people: ["riya"] }))).toEqual(["till", "mop"]);
    // People combine: either of them.
    expect(ids(filters({ people: [NOBODY, "riya"] }))).toEqual(["menu", "till", "mop"]);
  });

  it("matches any of the chosen labels and priorities", () => {
    expect(ids(filters({ labelIds: ["l-kitchen", "l-front"] }))).toEqual(["milk", "menu"]);
    expect(ids(filters({ priorities: ["URGENT", "HIGH"] }))).toEqual(["milk", "till"]);
  });

  it("requires every kind of filter to match at once", () => {
    expect(ids(filters({ people: [ME], priorities: ["LOW"] }))).toEqual(["mop"]);
    expect(ids(filters({ people: [ME], labelIds: ["l-front"] }))).toEqual([]);
  });
});

describe("neighboursFor", () => {
  it("names the cards above and below, null at the ends", () => {
    expect(neighboursFor(["a", "b", "c"], "b")).toEqual({ afterId: "a", beforeId: "c" });
    expect(neighboursFor(["a", "b", "c"], "a")).toEqual({ afterId: null, beforeId: "b" });
    expect(neighboursFor(["a", "b", "c"], "c")).toEqual({ afterId: "b", beforeId: null });
    expect(neighboursFor(["a"], "a")).toEqual({ afterId: null, beforeId: null });
    expect(neighboursFor(["a"], "missing")).toEqual({ afterId: null, beforeId: null });
  });

  it("steps over cards the server has not created yet", () => {
    const temp = `${TEMP_PREFIX}1`;
    expect(isTempId(temp)).toBe(true);
    expect(isTempId("a")).toBe(false);
    expect(neighboursFor([temp, "a"], "a")).toEqual({ afterId: null, beforeId: null });
    expect(neighboursFor(["a", temp, "b", "c"], "b")).toEqual({ afterId: "a", beforeId: "c" });
  });

  it("works from the full column, so a filter cannot reorder hidden cards", () => {
    // h1 and h2 are hidden by a filter; v1 and v2 are on screen; "x" was
    // dropped between v1 and v2. Its neighbours are the real ones, hidden or not.
    const full = placeAmongVisible(["v1", "h1", "h2", "v2"], ["v1", "x", "v2"], "x");
    expect(full).toEqual(["v1", "x", "h1", "h2", "v2"]);
    expect(neighboursFor(full, "x")).toEqual({ afterId: "v1", beforeId: "h1" });
  });
});

describe("moveToColumn / moveToTop", () => {
  const columns: Columns = { TODO: ["a", "b"], IN_PROGRESS: ["c", "d"], DONE: [] };

  it("puts the card before or after its anchor in the target column", () => {
    expect(moveToColumn(columns, "a", "IN_PROGRESS", "d", false).IN_PROGRESS).toEqual(["c", "a", "d"]);
    expect(moveToColumn(columns, "a", "IN_PROGRESS", "c", true).IN_PROGRESS).toEqual(["c", "a", "d"]);
    expect(moveToColumn(columns, "a", "IN_PROGRESS", "c", true).TODO).toEqual(["b"]);
  });

  it("drops onto the bottom without an anchor, or into an empty column", () => {
    expect(moveToColumn(columns, "a", "IN_PROGRESS", null, false).IN_PROGRESS).toEqual(["c", "d", "a"]);
    expect(moveToColumn(columns, "a", "IN_PROGRESS", "elsewhere", false).IN_PROGRESS).toEqual(["c", "d", "a"]);
    expect(moveToColumn(columns, "b", "DONE", null, false)).toEqual({ TODO: ["a"], IN_PROGRESS: ["c", "d"], DONE: ["b"] });
  });

  it("leaves the input alone", () => {
    moveToColumn(columns, "a", "DONE", null, false);
    expect(columns).toEqual({ TODO: ["a", "b"], IN_PROGRESS: ["c", "d"], DONE: [] });
  });

  it("moves to the top of a column, as the card menu does", () => {
    expect(moveToTop(columns, "b", "IN_PROGRESS").IN_PROGRESS).toEqual(["b", "c", "d"]);
    expect(moveToTop(columns, "b", "DONE").DONE).toEqual(["b"]);
    expect(moveToTop(columns, "b", "TODO").TODO).toEqual(["b", "a"]);
  });
});

describe("placeAmongVisible", () => {
  it("goes directly below the visible card now above it", () => {
    expect(placeAmongVisible(["a", "h", "b", "c"], ["b", "c", "a"], "a")).toEqual(["h", "b", "c", "a"]);
  });

  it("goes directly above the visible card below it when moved to the top", () => {
    expect(placeAmongVisible(["h1", "a", "h2", "b"], ["b", "a"], "b")).toEqual(["h1", "b", "a", "h2"]);
  });

  it("leaves the column alone when the card is the only one visible", () => {
    expect(placeAmongVisible(["h1", "a", "h2"], ["a"], "a")).toEqual(["h1", "a", "h2"]);
  });
});

describe("optimisticPosition / landedBetween", () => {
  const tasks = [
    card("a", { position: 1024 }),
    card("b", { position: 2048 }),
    card("p", { status: "IN_PROGRESS", position: 1024 }),
  ];

  it("picks the midpoint the server will, open at the ends", () => {
    expect(optimisticPosition(tasks, "a", "b")).toBe(1536);
    expect(optimisticPosition(tasks, null, "a")).toBe(0);
    expect(optimisticPosition(tasks, "b", null)).toBe(3072);
    expect(optimisticPosition(tasks, null, null)).toBe(POSITION_STEP);
  });

  it("accepts a card that sits between its neighbours in the same column", () => {
    expect(landedBetween(tasks, card("x", { position: 1536 }), "a", "b")).toBe(true);
    expect(landedBetween(tasks, card("x", { position: 0 }), null, "a")).toBe(true);
    expect(landedBetween(tasks, card("x", { position: 9 }), null, null)).toBe(true);
  });

  it("rejects a card the server had to place elsewhere", () => {
    // A renumbered column: the returned position no longer falls between them.
    expect(landedBetween(tasks, card("x", { position: 4096 }), "a", "b")).toBe(false);
    // A neighbour that has since left the column, or the board.
    expect(landedBetween(tasks, card("x", { position: 1536 }), "p", "b")).toBe(false);
    expect(landedBetween(tasks, card("x", { position: 1536 }), "a", "gone")).toBe(false);
  });
});

describe("liveFilters", () => {
  const labels = new Set(["kitchen"]);
  const offered = new Set(["riya"]);

  it("drops a deleted label and a person no longer offered, keeping the rest", () => {
    const picked = filters({ labelIds: ["kitchen", "gone"], people: ["riya", "left", ME, NOBODY], query: "milk" });
    expect(liveFilters(picked, labels, offered)).toEqual(
      filters({ labelIds: ["kitchen"], people: ["riya", ME, NOBODY], query: "milk" }),
    );
  });

  it("leaves no filter on when the only label picked has been deleted", () => {
    const live = liveFilters(filters({ labelIds: ["gone"] }), labels, offered);
    expect(hasFilters(live)).toBe(false);
  });

  it("hands back the same object when nothing has gone", () => {
    const picked = filters({ labelIds: ["kitchen"], people: [ME] });
    expect(liveFilters(picked, labels, offered)).toBe(picked);
  });
});
