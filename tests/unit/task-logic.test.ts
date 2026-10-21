import { describe, expect, it } from "vitest";
import {
  actorFor,
  activityLine,
  addConflict,
  applyChecklistChange,
  bylines,
  cardFingerprint,
  cardOf,
  checklistCounts,
  cleanTitle,
  contentOf,
  dropConflictField,
  dueBadge,
  emptyNewTask,
  filterLabels,
  freshestCard,
  hasFields,
  isAtLeastAsFresh,
  isPlausibleDay,
  isTempId,
  labelNameProblem,
  mergeDetail,
  mergeIdSet,
  mergeLabels,
  namer,
  omitFields,
  pickableMembers,
  planSave,
  revertItem,
  sameIdSet,
  settlePending,
  showCard,
  tempId,
  toCreateInput,
  toggleId,
  topOfColumn,
  wasAutoAssigned,
  wasEdited,
  withCard,
} from "@/components/task/task-logic";
import type { ActivityDTO, ChecklistItemDTO, LabelDTO, Member, TaskCard, TaskDetail } from "@/modules/tasks/types";

const OWNER: Member = { id: "u1", name: "Harsh", email: "h@example.com", color: "rust", avatar: "tiger", role: "OWNER", active: true };
const RIYA: Member = { id: "u2", name: "Riya", email: "r@example.com", color: "teal", avatar: null, role: "STAFF", active: true };
const GONE: Member = { id: "u3", name: "Sam", email: "s@example.com", color: "plum", avatar: null, role: "STAFF", active: false };
const MEMBERS = [OWNER, RIYA, GONE];

function card(overrides: Partial<TaskCard> = {}): TaskCard {
  return {
    id: "t1",
    title: "Order cardamom",
    description: "",
    status: "TODO",
    position: 1000,
    priority: "MEDIUM",
    dueDate: null,
    version: 1,
    completedAt: null,
    archivedAt: null,
    createdAt: "2026-10-17T09:00:00.000Z",
    updatedAt: "2026-10-17T09:00:00.000Z",
    createdById: "u1",
    updatedById: "u1",
    assigneeIds: [],
    labelIds: [],
    checklistDone: 0,
    checklistTotal: 0,
    commentCount: 0,
    ...overrides,
  };
}

function detail(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return { ...card(), checklist: [], comments: [], activity: [], ...overrides };
}

function item(id: string, text: string, done = false, position = 1): ChecklistItemDTO {
  return { id, text, done, position };
}

describe("who is looking", () => {
  it("takes the role from the member list, and treats a stranger as staff", () => {
    expect(actorFor(MEMBERS, "u1")).toEqual({ id: "u1", role: "OWNER" });
    expect(actorFor(MEMBERS, "u2")).toEqual({ id: "u2", role: "STAFF" });
    expect(actorFor(MEMBERS, "nobody")).toEqual({ id: "nobody", role: "STAFF" });
  });

  it("names the viewer as you, and anyone unknown as Someone", () => {
    const names = namer(MEMBERS, "u2");
    expect(names.subject("u2")).toBe("You");
    expect(names.object("u2")).toBe("you");
    expect(names.subject("u1")).toBe("Harsh");
    expect(names.object("zzz")).toBe("Someone");
  });

  it("offers active members, plus deactivated ones already picked", () => {
    expect(pickableMembers(MEMBERS, []).map((m) => m.id)).toEqual(["u1", "u2"]);
    expect(pickableMembers(MEMBERS, ["u3"]).map((m) => m.id)).toEqual(["u1", "u2", "u3"]);
  });
});

describe("labels", () => {
  const kitchen: LabelDTO = { id: "l1", name: "Kitchen", color: "amber" };
  const bar: LabelDTO = { id: "l2", name: "bar", color: "blue" };

  it("adds labels made here to the board's, the board's copy winning, sorted by name", () => {
    const renamed = { ...kitchen, name: "Kitchen prep" };
    expect(mergeLabels([renamed], [kitchen, bar]).map((l) => l.name)).toEqual(["bar", "Kitchen prep"]);
  });

  it("filters by name, ignoring case", () => {
    expect(filterLabels([kitchen, bar], "  KIT ")).toEqual([kitchen]);
    expect(filterLabels([kitchen, bar], "")).toEqual([kitchen, bar]);
  });

  it("refuses an empty, long or duplicate name before asking the server", () => {
    expect(labelNameProblem([kitchen], "  ")).toBe("Give the label a name.");
    expect(labelNameProblem([kitchen], "x".repeat(81))).toMatch(/80 characters/);
    expect(labelNameProblem([kitchen], " kitchen ")).toBe("There is already a label with that name.");
    expect(labelNameProblem([kitchen], "Front of house")).toBeNull();
  });
});

describe("cards", () => {
  it("strips a detail down to its card", () => {
    const d = detail({ checklist: [item("c1", "Milk")], title: "X" });
    const c = cardOf(d);
    expect(c.title).toBe("X");
    expect("checklist" in c).toBe(false);
    expect("comments" in c).toBe(false);
  });

  it("judges freshness by version, then by updatedAt (a move keeps the version)", () => {
    const old = card({ version: 2, updatedAt: "2026-10-17T10:00:00.000Z" });
    expect(isAtLeastAsFresh(card({ version: 3, updatedAt: "2026-10-17T09:00:00.000Z" }), old)).toBe(true);
    expect(isAtLeastAsFresh(card({ version: 2, updatedAt: "2026-10-17T11:00:00.000Z" }), old)).toBe(true);
    expect(isAtLeastAsFresh(card({ version: 2, updatedAt: "2026-10-17T09:59:00.000Z" }), old)).toBe(false);
    expect(isAtLeastAsFresh(old, old)).toBe(true);
  });

  it("picks the freshest copy, either side may be missing", () => {
    const a = card({ version: 1 });
    const b = card({ version: 2 });
    expect(freshestCard(a, b)).toBe(b);
    expect(freshestCard(null, b)).toBe(b);
    expect(freshestCard(a, null)).toBe(a);
    expect(freshestCard(null, null)).toBeNull();
    expect(freshestCard(a, { ...a })).toBe(a);
  });

  it("folds a newer read into the detail, keeping a fresher card already on screen", () => {
    const local = detail({ version: 3, title: "Mine, saved", checklist: [item("c1", "Old")] });
    const staleRead = detail({ version: 2, title: "Before", checklist: [item("c1", "Old"), item("c2", "New")] });
    const merged = mergeDetail(local, staleRead);
    expect(merged.title).toBe("Mine, saved");
    expect(merged.version).toBe(3);
    expect(merged.checklist.map((i) => i.id)).toEqual(["c1", "c2"]);

    const freshRead = detail({ version: 4, title: "Theirs" });
    expect(mergeDetail(local, freshRead)).toBe(freshRead);
    expect(mergeDetail(null, freshRead)).toBe(freshRead);
    expect(mergeDetail(detail({ id: "other" }), freshRead)).toBe(freshRead);
  });

  it("takes an action's card only when it is not older than what is shown", () => {
    const d = detail({ version: 3, checklist: [item("c1", "Keep")] });
    const newer = card({ version: 4, title: "New" });
    expect(withCard(d, newer).title).toBe("New");
    expect(withCard(d, newer).checklist).toHaveLength(1);
    expect(withCard(d, card({ version: 2, title: "Old" }))).toBe(d);
    expect(withCard(d, card({ id: "t2", version: 9 }))).toBe(d);
  });

  it("fingerprints what an open dialog should react to", () => {
    expect(cardFingerprint(null)).toBe("gone");
    const c = card();
    expect(cardFingerprint(c)).toBe(cardFingerprint({ ...c, title: "Changed but not yet stamped" }));
    expect(cardFingerprint(c)).not.toBe(cardFingerprint({ ...c, updatedAt: "2026-10-17T10:00:00.000Z" }));
    expect(cardFingerprint(c)).not.toBe(cardFingerprint({ ...c, commentCount: 1 }));
    expect(cardFingerprint(c)).not.toBe(cardFingerprint({ ...c, status: "DONE" }));
  });

  it("places a moved card above the first card of its new column, skipping itself", () => {
    const tasks = [
      card({ id: "a", status: "IN_PROGRESS", position: 2000 }),
      card({ id: "b", status: "IN_PROGRESS", position: 1000 }),
      card({ id: "c", status: "TODO", position: 500 }),
    ];
    expect(topOfColumn(tasks, "IN_PROGRESS", "c")).toEqual({ afterId: null, beforeId: "b" });
    expect(topOfColumn(tasks, "IN_PROGRESS", "b")).toEqual({ afterId: null, beforeId: "a" });
    expect(topOfColumn(tasks, "DONE", "c")).toEqual({ afterId: null, beforeId: null });
  });

  it("recognises the server assigning the mover", () => {
    expect(wasAutoAssigned([], ["u1"], "u1")).toBe(true);
    expect(wasAutoAssigned(["u2"], ["u2", "u1"], "u1")).toBe(false);
    expect(wasAutoAssigned([], [], "u1")).toBe(false);
  });
});

describe("checklist", () => {
  it("counts only saved items", () => {
    const items = [item("c1", "A", true), item("c2", "B"), item(tempId(1), "Pending", true)];
    expect(checklistCounts(items)).toEqual({ checklistDone: 1, checklistTotal: 2 });
    expect(isTempId(tempId(7))).toBe(true);
    expect(isTempId("c1")).toBe(false);
  });

  it("applies each kind of change without mutating the list", () => {
    const items = [item("c1", "A"), item("c2", "B")];
    const frozen = Object.freeze([...items]) as ChecklistItemDTO[];

    expect(applyChecklistChange(frozen, { kind: "add", item: item("t", "C") }).map((i) => i.id)).toEqual([
      "c1",
      "c2",
      "t",
    ]);
    expect(applyChecklistChange(frozen, { kind: "patch", id: "c2", patch: { done: true } })[1].done).toBe(true);
    expect(applyChecklistChange(frozen, { kind: "remove", id: "c1" }).map((i) => i.id)).toEqual(["c2"]);
    expect(frozen).toEqual(items);
  });

  it("swaps a temporary item for the saved one, even if a reload brought the saved one first", () => {
    const temp = item(tempId(1), "C");
    const saved = item("c3", "C");
    const withTemp = [item("c1", "A"), temp];
    expect(applyChecklistChange(withTemp, { kind: "replace", id: temp.id, item: saved }).map((i) => i.id)).toEqual([
      "c1",
      "c3",
    ]);
    const both = [item("c1", "A"), saved, temp];
    expect(applyChecklistChange(both, { kind: "replace", id: temp.id, item: saved }).map((i) => i.id)).toEqual([
      "c1",
      "c3",
    ]);
    // The temporary item already went (a reload replaced the list): the saved one is added once.
    expect(applyChecklistChange([item("c1", "A")], { kind: "replace", id: temp.id, item: saved }).map((i) => i.id)).toEqual([
      "c1",
      "c3",
    ]);
  });

  it("puts a failed delete back where it was, once", () => {
    const b = item("c2", "B");
    const list = [item("c1", "A"), item("c3", "C")];
    expect(applyChecklistChange(list, { kind: "insert", item: b, index: 1 }).map((i) => i.id)).toEqual(["c1", "c2", "c3"]);
    expect(applyChecklistChange(list, { kind: "insert", item: b, index: 99 }).map((i) => i.id)).toEqual(["c1", "c3", "c2"]);
    const restored = applyChecklistChange(list, { kind: "insert", item: b, index: 1 });
    expect(applyChecklistChange(restored, { kind: "insert", item: b, index: 0 })).toBe(restored);
  });

  it("undoes a refused edit only where the screen still shows it", () => {
    const ticked = [item("c1", "Milk", true)];
    expect(revertItem(ticked, "c1", { done: true }, { done: false })[0].done).toBe(false);
    // Unticked again since: that later edit owns the field now.
    const unticked = [item("c1", "Milk", false)];
    expect(revertItem(unticked, "c1", { done: true }, { done: false })[0].done).toBe(false);
    const renamedAgain = [item("c1", "Oat milk")];
    expect(revertItem(renamedAgain, "c1", { text: "Soy milk" }, { text: "Milk" })[0].text).toBe("Oat milk");
    expect(revertItem([item("c1", "Soy milk")], "c1", { text: "Soy milk" }, { text: "Milk" })[0].text).toBe("Milk");
  });
});

describe("saving content", () => {
  const latest = contentOf(card({ title: "Theirs", priority: "HIGH", assigneeIds: ["u2", "u3"], labelIds: ["l1"] }));

  it("sends a field nobody else touched", () => {
    const plan = planSave({ title: "Mine" }, { title: "Theirs" }, latest);
    expect(plan).toEqual({ send: { title: "Mine" }, conflicted: {} });
  });

  it("hands back a field somebody else changed meanwhile instead of overwriting it", () => {
    const plan = planSave({ title: "Mine", priority: "LOW" }, { title: "Original", priority: "HIGH" }, latest);
    expect(plan.send).toEqual({ priority: "LOW" });
    expect(plan.conflicted).toEqual({ title: "Mine" });
  });

  it("sends nothing for a field that already holds the person's value", () => {
    expect(planSave({ title: "Theirs" }, { title: "Original" }, latest)).toEqual({ send: {}, conflicted: {} });
  });

  it("takes a missing original as unchanged since the person started", () => {
    expect(planSave({ dueDate: "2026-10-20" }, {}, latest).send).toEqual({ dueDate: "2026-10-20" });
  });

  it("merges the people and label sets so both people's picks survive", () => {
    // I added u1 to [u2]; meanwhile somebody added u3.
    const plan = planSave({ assigneeIds: ["u2", "u1"] }, { assigneeIds: ["u2"] }, latest);
    expect(plan.send).toEqual({ assigneeIds: ["u2", "u3", "u1"] });
    // I removed l1, and nobody else changed labels.
    expect(planSave({ labelIds: [] }, { labelIds: ["l1"] }, latest).send).toEqual({ labelIds: [] });
    // My removal is already true on the server: nothing to send.
    expect(planSave({ assigneeIds: [] }, { assigneeIds: ["u4"] }, contentOf(card())).send).toEqual({});
  });

  it("merges sets three ways", () => {
    expect(mergeIdSet(["a", "b"], ["b", "c"], ["a", "b", "d"])).toEqual(["b", "d", "c"]);
    expect(mergeIdSet([], ["a"], ["a"])).toEqual(["a"]);
  });

  it("small set helpers", () => {
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleId(["a"], "b")).toEqual(["a", "b"]);
    expect(sameIdSet(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameIdSet(["a"], ["a", "b"])).toBe(false);
    expect(hasFields({ title: undefined })).toBe(false);
    expect(hasFields({ dueDate: null })).toBe(true);
    expect(omitFields({ title: "x", priority: "LOW" }, { title: "y" })).toEqual({ priority: "LOW" });
  });

  it("lays unanswered changes over the confirmed card", () => {
    const shown = showCard(card({ priority: "LOW", dueDate: "2026-10-20" }), { priority: "URGENT", dueDate: null });
    expect(shown.priority).toBe("URGENT");
    expect(shown.dueDate).toBeNull();
    expect(showCard(card({ title: "Kept" }), { title: undefined }).title).toBe("Kept");
  });

  it("clears a settled change, but keeps one made again since", () => {
    expect(settlePending({ priority: "HIGH" }, { priority: "HIGH" })).toEqual({});
    expect(settlePending({ priority: "URGENT" }, { priority: "HIGH" })).toEqual({ priority: "URGENT" });
    expect(settlePending({ assigneeIds: ["a", "b"] }, { assigneeIds: ["a", "b"] })).toEqual({});
    expect(settlePending({ assigneeIds: ["a", "b", "c"] }, { assigneeIds: ["a", "b"] })).toEqual({
      assigneeIds: ["a", "b", "c"],
    });
    expect(settlePending({ dueDate: null, title: "x" }, { dueDate: null })).toEqual({ title: "x" });
  });

  it("collects conflicts and lets them go one field at a time", () => {
    expect(addConflict(null, {})).toBeNull();
    const first = addConflict(null, { title: "Mine" });
    const both = addConflict(first, { priority: "LOW" });
    expect(both).toEqual({ fields: { title: "Mine", priority: "LOW" } });
    expect(dropConflictField(both, "title")).toEqual({ fields: { priority: "LOW" } });
    expect(dropConflictField(dropConflictField(both, "title"), "priority")).toBeNull();
    expect(dropConflictField(null, "title")).toBeNull();
  });
});

describe("display rules", () => {
  it("counts a change more than a second after creation as an edit", () => {
    expect(wasEdited("2026-10-17T09:00:00.000Z", "2026-10-17T09:00:00.001Z")).toBe(false);
    expect(wasEdited("2026-10-17T09:00:00.000Z", "2026-10-17T09:00:05.000Z")).toBe(true);
  });

  it("keeps titles to one trimmed line", () => {
    expect(cleanTitle("  Buy\n  oat milk \t")).toBe("Buy oat milk");
    expect(cleanTitle(" \n ")).toBe("");
  });

  it("only saves a due date while typing once the year is plausible", () => {
    expect(isPlausibleDay("2026-10-17")).toBe(true);
    expect(isPlausibleDay("0202-10-17")).toBe(false);
    expect(isPlausibleDay("2026-02-31")).toBe(false);
    expect(isPlausibleDay("")).toBe(false);
  });

  it("badges a due date that is close or past, but never on finished work", () => {
    const today = "2026-10-17";
    expect(dueBadge("2026-10-16", "TODO", today)).toEqual({ state: "overdue", text: "Overdue" });
    expect(dueBadge("2026-10-17", "IN_PROGRESS", today)).toEqual({ state: "today", text: "Due today" });
    expect(dueBadge("2026-10-19", "TODO", today)).toEqual({ state: "soon", text: "Due soon" });
    expect(dueBadge("2026-10-30", "TODO", today)).toBeNull();
    expect(dueBadge("2026-10-01", "DONE", today)).toBeNull();
    expect(dueBadge(null, "TODO", today)).toBeNull();
  });

  it("writes who made and last changed the task", () => {
    const now = new Date("2026-10-17T12:00:00.000Z");
    const fresh = card({ createdById: "u2", createdAt: "2026-10-17T10:00:00.000Z", updatedAt: "2026-10-17T10:00:00.000Z" });
    expect(bylines(fresh, MEMBERS, "u1", now)).toEqual({ created: "Created by Riya · 2h ago", edited: null });
    const edited = { ...fresh, updatedById: "u1", updatedAt: "2026-10-17T11:55:00.000Z" };
    expect(bylines(edited, MEMBERS, "u1", now)).toEqual({
      created: "Created by Riya · 2h ago",
      edited: "Last edited by you · 5m ago",
    });
  });

  it("prefixes history with who did it", () => {
    const moved: ActivityDTO = {
      id: "a1",
      actorId: "u1",
      type: "moved",
      detail: { from: "TODO", to: "IN_PROGRESS" },
      createdAt: "2026-10-17T09:00:00.000Z",
    };
    expect(activityLine(moved, MEMBERS, "u1")).toBe("You moved this from To do to In progress");
    expect(activityLine(moved, MEMBERS, "u2")).toBe("Harsh moved this from To do to In progress");
    const assigned: ActivityDTO = { ...moved, type: "assigned", detail: { userIds: ["u2"] } };
    expect(activityLine(assigned, MEMBERS, "u2")).toBe("Harsh assigned you");
  });
});

describe("new tasks", () => {
  it("starts empty, Medium, in the column asked for", () => {
    expect(emptyNewTask("IN_PROGRESS")).toEqual({
      title: "",
      description: "",
      status: "IN_PROGRESS",
      priority: "MEDIUM",
      dueDate: "",
      assigneeIds: [],
      labelIds: [],
    });
  });

  it("turns the form into a create input", () => {
    const form = { ...emptyNewTask("TODO"), title: "  Restock\nchai ", description: " Two boxes \n", dueDate: "2026-10-20" };
    expect(toCreateInput(form)).toEqual({
      ok: true,
      input: {
        title: "Restock chai",
        description: "Two boxes",
        status: "TODO",
        priority: "MEDIUM",
        dueDate: "2026-10-20",
        assigneeIds: [],
        labelIds: [],
      },
    });
    const noDue = toCreateInput({ ...form, dueDate: "" });
    expect(noDue.ok && noDue.input.dueDate).toBeNull();
  });

  it("says what is wrong before sending", () => {
    expect(toCreateInput(emptyNewTask("TODO"))).toEqual({ ok: false, field: "title", error: "Give the task a title." });
    expect(toCreateInput({ ...emptyNewTask("TODO"), title: "x".repeat(201) })).toMatchObject({ ok: false, field: "title" });
    expect(toCreateInput({ ...emptyNewTask("TODO"), title: "Ok", dueDate: "2026-02-31" })).toEqual({
      ok: false,
      field: "dueDate",
      error: "That due date is not a real day.",
    });
  });
});
