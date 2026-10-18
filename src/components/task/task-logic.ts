import { dueState, parseDay, timeAgo, type DueState } from "@/lib/dates";
import type { Actor } from "@/lib/permissions";
import { describeActivity } from "@/modules/tasks/activity";
import type {
  ActivityDTO,
  ChecklistItemDTO,
  CreateTaskInput,
  LabelDTO,
  BoardMember,
  Priority,
  Status,
  TaskCard,
  TaskDetail,
} from "@/modules/tasks/types";

/*
  The task dialogs' bookkeeping, kept apart from the components so it can be
  tested without a browser. Pure and client-safe: nothing here touches React,
  the network or the DOM.

  The hardest part is saving while somebody else may be saving too. A task's
  `version` goes up on every content change, so a save is sent against the
  latest version this browser knows — but "latest known" may already be out
  of date, or a teammate's change may have arrived while this person was
  typing. planSave() is where that is resolved: a field nobody else touched
  is simply sent; a field somebody else changed in the meantime is a
  conflict the person is shown, never overwritten; and the people and labels
  lists, which are sets, are merged so both people's picks survive.
*/

// ── Who is looking ─────────────────────────────────────────────────────────

/**
  The signed-in person as the permission rules see them. Someone missing from
  the member list (a board read from before they were added) is treated as
  staff: a control hidden in error costs a reload, one shown in error just
  fails.
*/
export function actorFor(members: BoardMember[], userId: string): Actor {
  const me = members.find((m) => m.id === userId);
  return { id: userId, role: me?.role ?? "STAFF" };
}

/**
  Display names for history lines and bylines. The signed-in person reads as
  "You" at the start of a sentence and "you" inside one; a name we cannot
  find (should not happen — accounts are deactivated, never deleted) reads as
  "Someone" rather than an id.
*/
export function namer(members: BoardMember[], currentUserId: string) {
  const byId = new Map(members.map((m) => [m.id, m.name]));
  const name = (id: string) => byId.get(id) ?? "Someone";
  return {
    subject: (id: string) => (id === currentUserId ? "You" : name(id)),
    object: (id: string) => (id === currentUserId ? "you" : name(id)),
  };
}

/** Members who can be picked: active ones, plus anyone already picked so they can be taken off. */
export function pickableMembers(members: BoardMember[], selectedIds: string[]): BoardMember[] {
  return members.filter((m) => m.active || selectedIds.includes(m.id));
}

/** The board's labels plus any created in this dialog that the board has not caught up with yet. */
export function mergeLabels(boardLabels: LabelDTO[], extra: LabelDTO[]): LabelDTO[] {
  const byId = new Map<string, LabelDTO>();
  for (const label of extra) byId.set(label.id, label);
  // The board's copy wins: it is the newer read once it has refetched.
  for (const label of boardLabels) byId.set(label.id, label);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

// ── Cards ──────────────────────────────────────────────────────────────────

/** The card part of a full task. */
export function cardOf(detail: TaskDetail): TaskCard {
  const { checklist, comments, activity, ...card } = detail;
  void checklist;
  void comments;
  void activity;
  return card;
}

/**
  Whether `a` describes the task at least as recently as `b`. The version
  only ever goes up; a move leaves it alone but stamps updatedAt, and ISO
  timestamps in UTC compare correctly as text.
*/
export function isAtLeastAsFresh(a: TaskCard, b: TaskCard): boolean {
  if (a.version !== b.version) return a.version > b.version;
  return a.updatedAt >= b.updatedAt;
}

/** The newer of two copies of the same card; `a` on a tie. */
export function freshestCard(a: TaskCard | null, b: TaskCard | null): TaskCard | null {
  if (!a) return b;
  if (!b) return a;
  return isAtLeastAsFresh(a, b) ? a : b;
}

/**
  A newer read of the whole task folded into the one on screen: the server's
  checklist, comments and history, and whichever copy of the card is fresher
  — an action's answer can land after a read that started before it.
*/
export function mergeDetail(local: TaskDetail | null, server: TaskDetail): TaskDetail {
  if (!local || local.id !== server.id) return server;
  const onScreen = cardOf(local);
  return isAtLeastAsFresh(cardOf(server), onScreen) ? server : { ...server, ...onScreen };
}

/** `detail` with the card an action came back with, unless what is on screen is already newer. */
export function withCard(detail: TaskDetail, card: TaskCard): TaskDetail {
  if (card.id !== detail.id || !isAtLeastAsFresh(card, cardOf(detail))) return detail;
  return { ...detail, ...card };
}

/**
  What, on the board's copy of a card, means the open dialog is out of date.
  updatedAt covers content, people, moves and checklist edits; comments do
  not touch the task, so their count is part of it too. null is a card that
  has left the board (deleted or archived).
*/
export function cardFingerprint(card: TaskCard | null): string {
  if (!card) return "gone";
  return [card.updatedAt, card.status, card.commentCount, card.checklistDone, card.checklistTotal].join("|");
}

/**
  The card in `status`'s column that a card moved there should sit above, so
  it lands at the top. The moving card itself is skipped: it may already be
  in that column.
*/
export function topOfColumn(
  tasks: TaskCard[],
  status: Status,
  movingId: string,
): { afterId: null; beforeId: string | null } {
  let first: TaskCard | null = null;
  for (const t of tasks) {
    if (t.status !== status || t.id === movingId || t.archivedAt) continue;
    if (!first || t.position < first.position) first = t;
  }
  return { afterId: null, beforeId: first?.id ?? null };
}

/** Dragging or moving an unassigned card into In progress assigns the mover. */
export function wasAutoAssigned(before: string[], after: string[], userId: string): boolean {
  return before.length === 0 && after.includes(userId);
}

// ── Checklist ──────────────────────────────────────────────────────────────

const TEMP_PREFIX = "temp-";

/** Items added optimistically carry a temporary id until the server answers. */
export function tempId(n: number): string {
  return `${TEMP_PREFIX}${n}`;
}

export function isTempId(id: string): boolean {
  return id.startsWith(TEMP_PREFIX);
}

/** Done and total, counting only items the server has confirmed. */
export function checklistCounts(items: ChecklistItemDTO[]): Pick<TaskCard, "checklistDone" | "checklistTotal"> {
  const saved = items.filter((i) => !isTempId(i.id));
  return { checklistDone: saved.filter((i) => i.done).length, checklistTotal: saved.length };
}

export type ChecklistChange =
  | { kind: "add"; item: ChecklistItemDTO }
  | { kind: "patch"; id: string; patch: Partial<Pick<ChecklistItemDTO, "text" | "done">> }
  | { kind: "replace"; id: string; item: ChecklistItemDTO }
  | { kind: "remove"; id: string }
  | { kind: "insert"; item: ChecklistItemDTO; index: number };

/**
  One checklist edit, applied without mutating `items`. "replace" swaps a
  temporary item for the saved one (or refreshes a saved one); "insert" puts
  back an item whose delete failed, where it was.
*/
export function applyChecklistChange(items: ChecklistItemDTO[], change: ChecklistChange): ChecklistItemDTO[] {
  switch (change.kind) {
    case "add":
      return [...items, change.item];
    case "patch":
      return items.map((i) => (i.id === change.id ? { ...i, ...change.patch } : i));
    case "replace": {
      // The saved item may already be here if a reload brought it in first.
      const rest = change.id === change.item.id ? items : items.filter((i) => i.id !== change.item.id);
      if (!rest.some((i) => i.id === change.id)) return [...rest, change.item];
      return rest.map((i) => (i.id === change.id ? change.item : i));
    }
    case "remove":
      return items.filter((i) => i.id !== change.id);
    case "insert": {
      if (items.some((i) => i.id === change.item.id)) return items;
      const at = Math.max(0, Math.min(change.index, items.length));
      return [...items.slice(0, at), change.item, ...items.slice(at)];
    }
  }
}

type ItemFields = Partial<Pick<ChecklistItemDTO, "text" | "done">>;

/**
  Undo an optimistic edit to one item that the server refused — but only the
  fields still showing what was sent. A field changed again since belongs to
  a later edit, which is answered (or undone) on its own.
*/
export function revertItem(items: ChecklistItemDTO[], id: string, sent: ItemFields, previous: ItemFields): ChecklistItemDTO[] {
  return items.map((item) => {
    if (item.id !== id) return item;
    const out = { ...item };
    if (sent.text !== undefined && previous.text !== undefined && item.text === sent.text) out.text = previous.text;
    if (sent.done !== undefined && previous.done !== undefined && item.done === sent.done) out.done = previous.done;
    return out;
  });
}

// ── Content edits and conflicts ────────────────────────────────────────────

export type ContentFields = Pick<TaskCard, "title" | "description" | "priority" | "dueDate" | "assigneeIds" | "labelIds">;
export type ContentPatch = Partial<ContentFields>;

/** Fields where one value replaces another, so two people changing them collide. */
export const SCALAR_FIELDS = ["title", "description", "priority", "dueDate"] as const;
export type ScalarField = (typeof SCALAR_FIELDS)[number];
export type ScalarPatch = Partial<Pick<ContentFields, ScalarField>>;

/** Fields that are sets of ids, where two people's changes can both be kept. */
const SET_FIELDS = ["assigneeIds", "labelIds"] as const;

export function contentOf(card: TaskCard): ContentFields {
  return {
    title: card.title,
    description: card.description,
    priority: card.priority,
    dueDate: card.dueDate,
    assigneeIds: card.assigneeIds,
    labelIds: card.labelIds,
  };
}

export function hasFields(patch: object): boolean {
  return Object.values(patch).some((v) => v !== undefined);
}

/** Add `id` if absent, remove it if present; order otherwise kept. */
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** Same members, in any order. */
export function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
  A three-way merge of a set: what this person added to and removed from
  `original`, applied to `latest` (which may include somebody else's changes
  since). Keeps `latest`'s order and appends additions in the order picked.
*/
export function mergeIdSet(original: string[], mine: string[], latest: string[]): string[] {
  const added = mine.filter((id) => !original.includes(id));
  const removed = new Set(original.filter((id) => !mine.includes(id)));
  const out = latest.filter((id) => !removed.has(id));
  for (const id of added) if (!out.includes(id)) out.push(id);
  return out;
}

export type SavePlan = {
  /** What to send to the server, resolved against `latest`. */
  send: ContentPatch;
  /** This person's values for fields somebody else changed since they started; not sent. */
  conflicted: ScalarPatch;
};

/**
  Decide what a save should send, given what the person changed (`patch`),
  what those fields held when they started (`originals`), and the task as
  this browser now knows it (`latest`).

    - A field already holding the person's value needs nothing sent.
    - A text or single-value field somebody else changed since the person
      started is a conflict: theirs is kept, the person's is handed back.
    - The people and label sets are merged, so a teammate picking up the
      task while an owner adds a label loses neither.

  A field with no original is taken as unchanged since the person started.
*/
export function planSave(patch: ContentPatch, originals: ContentPatch, latest: ContentFields): SavePlan {
  const send: Record<string, unknown> = {};
  const conflicted: Record<string, unknown> = {};

  for (const key of SCALAR_FIELDS) {
    const mine = patch[key];
    if (mine === undefined) continue;
    const now = latest[key];
    if (mine === now) continue;
    const original = originals[key] === undefined ? now : originals[key];
    if (original !== now) conflicted[key] = mine;
    else send[key] = mine;
  }

  for (const key of SET_FIELDS) {
    const mine = patch[key];
    if (mine === undefined) continue;
    const merged = mergeIdSet(originals[key] ?? latest[key], mine, latest[key]);
    if (!sameIdSet(merged, latest[key])) send[key] = merged;
  }

  return { send: send as ContentPatch, conflicted: conflicted as ScalarPatch };
}

/** `patch` without the given fields. */
export function omitFields(patch: ContentPatch, fields: object): ContentPatch {
  const out: Record<string, unknown> = { ...patch };
  for (const key of Object.keys(fields)) delete out[key];
  return out as ContentPatch;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  return a === b;
}

/**
  The card as the person sees it: what the server last confirmed, with the
  changes they have made but the server has not answered yet laid on top, so
  a pick shows at once rather than after the round trip.
*/
export function showCard(card: TaskCard, pending: ContentPatch): TaskCard {
  const out: Record<string, unknown> = { ...card };
  for (const [key, value] of Object.entries(pending)) if (value !== undefined) out[key] = value;
  return out as TaskCard;
}

/**
  The pending changes left once a save of `patch` has been answered, either
  way. A field the person has changed again since keeps its newer value — it
  belongs to a save still queued behind this one.
*/
export function settlePending(pending: ContentPatch, patch: ContentPatch): ContentPatch {
  const out: Record<string, unknown> = { ...pending };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && sameValue(out[key], value)) delete out[key];
  }
  return out as ContentPatch;
}

/** Somebody else's save beat this person's: who, and the values of theirs that were not sent. */
/*
  No author on purpose. The task's last toucher is not the person whose edit
  clashed: a checklist tick or a drag also stamps updatedById without moving
  the version, so naming them pointed at the wrong person — often a staff
  member, who cannot edit these fields at all.
*/
export type Conflict = { fields: ScalarPatch };

/** Another clash on top of any still showing. */
export function addConflict(current: Conflict | null, fields: ScalarPatch): Conflict | null {
  if (!hasFields(fields)) return current;
  return { fields: { ...(current?.fields ?? {}), ...fields } };
}

/** One field dealt with (re-applied or let go); null once none are left. */
export function dropConflictField(current: Conflict | null, field: ScalarField): Conflict | null {
  if (!current) return null;
  const fields = { ...current.fields };
  delete fields[field];
  return hasFields(fields) ? { ...current, fields } : null;
}

// ── Small display rules ────────────────────────────────────────────────────

/**
  A comment (or task) counts as edited when it was changed more than a second
  after it was made: the two timestamps are stamped separately on create and
  can differ by a millisecond.
*/
export function wasEdited(createdAt: string, updatedAt: string): boolean {
  return Date.parse(updatedAt) - Date.parse(createdAt) > 1000;
}

/**
  Titles are one line: newlines (from a paste) become spaces and the ends are
  trimmed, matching what the server stores.
*/
export function cleanTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
  A due date worth saving while the person may still be typing. A date
  field reports every keystroke in the year as a real day — 0002, 0020,
  0202 — so only a plausible year is saved before the field loses focus.
*/
export function isPlausibleDay(value: string): boolean {
  const day = parseDay(value);
  if (!day) return false;
  const year = day.getUTCFullYear();
  return year >= 2000 && year < 2200;
}

/**
  The due date's warning, if it deserves one. Finished work is not late, so a
  done task's date is shown plainly; a date more than two days out needs no
  badge either.
*/
export function dueBadge(
  dueDate: string | null,
  status: Status,
  today: string,
): { state: Exclude<DueState, "later">; text: string } | null {
  if (!dueDate || status === "DONE") return null;
  const state = dueState(dueDate, today);
  if (state === "overdue") return { state, text: "Overdue" };
  if (state === "today") return { state, text: "Due today" };
  if (state === "soon") return { state, text: "Due soon" };
  return null;
}

/** "Created by Riya · 2h ago" and, once it has been changed since, "Last edited by you · 5m ago". */
export function bylines(
  card: Pick<TaskCard, "createdById" | "createdAt" | "updatedById" | "updatedAt">,
  members: BoardMember[],
  currentUserId: string,
  now: Date,
): { created: string; edited: string | null } {
  const names = namer(members, currentUserId);
  const created = `Created by ${names.object(card.createdById)} · ${timeAgo(card.createdAt, now)}`;
  const edited = wasEdited(card.createdAt, card.updatedAt)
    ? `Last edited by ${names.object(card.updatedById)} · ${timeAgo(card.updatedAt, now)}`
    : null;
  return { created, edited };
}

/** One line of history: "You moved this from To do to In progress", "Riya assigned you". */
export function activityLine(activity: ActivityDTO, members: BoardMember[], currentUserId: string): string {
  const names = namer(members, currentUserId);
  return `${names.subject(activity.actorId)} ${describeActivity(activity, names.object)}`;
}

// ── Labels ─────────────────────────────────────────────────────────────────

/** Labels whose name contains `query`, ignoring case and surrounding space. */
export function filterLabels(labels: LabelDTO[], query: string): LabelDTO[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return labels;
  return labels.filter((l) => l.name.toLocaleLowerCase().includes(q));
}

/**
  Why a new label cannot be called `name`, or null if it can. Names are
  unique regardless of case on the server; saying so here saves a round trip
  that would only be refused.
*/
export function labelNameProblem(labels: LabelDTO[], name: string): string | null {
  const clean = name.trim();
  if (!clean) return "Give the label a name.";
  if (clean.length > 80) return "Keep label names to 80 characters or fewer.";
  const lower = clean.toLocaleLowerCase();
  if (labels.some((l) => l.name.toLocaleLowerCase() === lower)) return "There is already a label with that name.";
  return null;
}

// ── New tasks ──────────────────────────────────────────────────────────────

export type NewTaskForm = {
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  /** "" for none, as a date field reports it. */
  dueDate: string;
  assigneeIds: string[];
  labelIds: string[];
};

export function emptyNewTask(status: Status): NewTaskForm {
  return { title: "", description: "", status, priority: "MEDIUM", dueDate: "", assigneeIds: [], labelIds: [] };
}

/**
  The form as createTaskAction wants it, or what is wrong with it. Checked
  again on the server; this is so the person hears about an empty title
  without waiting for a round trip.
*/
export function toCreateInput(
  form: NewTaskForm,
): { ok: true; input: CreateTaskInput } | { ok: false; field: "title" | "dueDate"; error: string } {
  const title = cleanTitle(form.title);
  if (!title) return { ok: false, field: "title", error: "Give the task a title." };
  if (title.length > 200) return { ok: false, field: "title", error: "Keep the title to 200 characters or fewer." };
  const due = form.dueDate.trim();
  if (due && !parseDay(due)) return { ok: false, field: "dueDate", error: "That due date is not a real day." };
  return {
    ok: true,
    input: {
      title,
      description: form.description.trim(),
      status: form.status,
      priority: form.priority,
      dueDate: due || null,
      assigneeIds: form.assigneeIds,
      labelIds: form.labelIds,
    },
  };
}
