/*
  The board's bookkeeping, kept pure so it can be tested without a browser:
  ordering, filtering, and working out where a dragged card landed.

  Two lists matter for every column. The FULL order is every card in the
  column, as the server orders it. The VISIBLE order is what the filters leave
  on screen. Drags happen in the visible order, but a move is always sent as
  neighbours in the full order — otherwise dropping a card while a filter is
  on would quietly reorder the cards the filter is hiding.
*/

import { positionBetween } from "@/modules/tasks/position";
import {
  STATUSES,
  type LabelDTO,
  type Priority,
  type Status,
  type TaskCard,
} from "@/modules/tasks/types";

export type Columns = Record<Status, string[]>;

/** Stands for the viewer in a people filter, so "My tasks" survives being remembered. */
export const ME = "me";
/** Stands for "nobody is on it" in a people filter. */
export const NOBODY = "none";

export type BoardFilters = {
  query: string;
  /** Member ids, ME or NOBODY; a card matches if any of them fits. Empty means everyone. */
  people: string[];
  /** A card matches if it carries any of these. */
  labelIds: string[];
  priorities: Priority[];
};

export const NO_FILTERS: BoardFilters = { query: "", people: [], labelIds: [], priorities: [] };

/** Ids for cards that exist only in this browser until the server answers a quick add. */
export const TEMP_PREFIX = "pending:";

export function isTempId(id: string): boolean {
  return id.startsWith(TEMP_PREFIX);
}

/*
  The filters as picked, less anything that has since gone: a label another
  owner deleted, or a person no longer offered (deactivated, and so off every
  card). Left in, a deleted label that was the only one picked matched no
  card at all, while the toolbar — which has nothing to show for it — looked
  as if no filter were on, and only "Clear filters" got the board back.
  Returns the same object when nothing needed dropping.
*/
export function liveFilters(
  filters: BoardFilters,
  labelIds: ReadonlySet<string>,
  offeredPeople: ReadonlySet<string>,
): BoardFilters {
  const labels = filters.labelIds.filter((id) => labelIds.has(id));
  const people = filters.people.filter((id) => id === ME || id === NOBODY || offeredPeople.has(id));
  return labels.length === filters.labelIds.length && people.length === filters.people.length
    ? filters
    : { ...filters, labelIds: labels, people };
}

export function hasFilters(filters: BoardFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.people.length > 0 ||
    filters.labelIds.length > 0 ||
    filters.priorities.length > 0
  );
}

// ── Order ─────────────────────────────────────────────────────────────────

const STATUS_RANK: Record<Status, number> = { TODO: 0, IN_PROGRESS: 1, DONE: 2 };

/** The server's order: column, then position, then id to break a tie. */
export function compareTasks(a: TaskCard, b: TaskCard): number {
  return (
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    a.position - b.position ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function sortTasks(tasks: readonly TaskCard[]): TaskCard[] {
  return [...tasks].sort(compareTasks);
}

/** The card replaced (or added), the list kept in board order. */
export function upsertTask(tasks: readonly TaskCard[], card: TaskCard): TaskCard[] {
  const i = tasks.findIndex((t) => t.id === card.id);
  const next = i >= 0 ? tasks.map((t, j) => (j === i ? card : t)) : [...tasks, card];
  return sortTasks(next);
}

export function removeTask(tasks: readonly TaskCard[], id: string): TaskCard[] {
  return tasks.filter((t) => t.id !== id);
}

export function columnsOf(tasks: readonly TaskCard[]): Columns {
  const columns: Columns = { TODO: [], IN_PROGRESS: [], DONE: [] };
  for (const t of sortTasks(tasks)) columns[t.status].push(t.id);
  return columns;
}

/** Which column holds `id`, or null. */
export function findColumn(columns: Columns, id: string): Status | null {
  for (const s of STATUSES) if (columns[s].includes(id)) return s;
  return null;
}

// ── Filters ───────────────────────────────────────────────────────────────

function matchesPeople(task: TaskCard, people: string[], currentUserId: string): boolean {
  if (people.length === 0) return true;
  return people.some((p) => {
    if (p === NOBODY) return task.assigneeIds.length === 0;
    return task.assigneeIds.includes(p === ME ? currentUserId : p);
  });
}

/**
  Every word of the query has to turn up somewhere in the title, the
  description or a label's name — so "milk kitchen" finds the milk order
  labelled Kitchen without the words having to sit together.
*/
function matchesQuery(task: TaskCard, query: string, labelNames: Map<string, string>): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [task.title, task.description, ...task.labelIds.map((id) => labelNames.get(id) ?? "")]
    .join("\n")
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
}

/** The cards the filters leave on the board, in the order given. */
export function filterTasks(
  tasks: readonly TaskCard[],
  filters: BoardFilters,
  ctx: { currentUserId: string; labels: readonly LabelDTO[] },
): TaskCard[] {
  if (!hasFilters(filters)) return [...tasks];
  const labelNames = new Map(ctx.labels.map((l) => [l.id, l.name]));
  return tasks.filter(
    (t) =>
      matchesPeople(t, filters.people, ctx.currentUserId) &&
      (filters.labelIds.length === 0 || t.labelIds.some((id) => filters.labelIds.includes(id))) &&
      (filters.priorities.length === 0 || filters.priorities.includes(t.priority)) &&
      matchesQuery(t, filters.query, labelNames),
  );
}

// ── Moving ────────────────────────────────────────────────────────────────

/**
  The cards directly above and below `cardId` in a column's FULL order — what
  moveTaskAction wants. A quick-added card still waiting on the server is
  stepped over: the server has never heard of its id, and it is headed for
  the top of its column anyway.
*/
export function neighboursFor(
  columnIds: readonly string[],
  cardId: string,
): { afterId: string | null; beforeId: string | null } {
  const ids = columnIds.filter((id) => id === cardId || !isTempId(id));
  const i = ids.indexOf(cardId);
  if (i < 0) return { afterId: null, beforeId: null };
  return { afterId: ids[i - 1] ?? null, beforeId: ids[i + 1] ?? null };
}

/**
  `cardId` taken out of whichever column holds it and put into `to`, next to
  `anchorId` (after it when `placeAfter`, else before it). With no anchor, or
  one not in `to`, it goes to the bottom — what dropping onto a column's
  empty space means.
*/
export function moveToColumn(
  columns: Columns,
  cardId: string,
  to: Status,
  anchorId: string | null,
  placeAfter: boolean,
): Columns {
  const next: Columns = {
    TODO: columns.TODO.filter((id) => id !== cardId),
    IN_PROGRESS: columns.IN_PROGRESS.filter((id) => id !== cardId),
    DONE: columns.DONE.filter((id) => id !== cardId),
  };
  const target = next[to];
  const at = anchorId === null ? -1 : target.indexOf(anchorId);
  if (at < 0) target.push(cardId);
  else target.splice(placeAfter ? at + 1 : at, 0, cardId);
  return next;
}

/** `cardId` moved to the top of `to`: where the card menu's "Move to" puts it. */
export function moveToTop(columns: Columns, cardId: string, to: Status): Columns {
  const first = columns[to].find((id) => id !== cardId) ?? null;
  return moveToColumn(columns, cardId, to, first, false);
}

/**
  Turns a reorder made in the visible list back into the full list. The card
  goes directly below the visible card now above it (or, at the top, directly
  above the visible card below it); cards the filter hides keep their places
  relative to everything else. If the card is the only one visible there is
  nothing to go by and the full list is returned unchanged.
*/
export function placeAmongVisible(
  columnIds: readonly string[],
  visibleOrder: readonly string[],
  cardId: string,
): string[] {
  const i = visibleOrder.indexOf(cardId);
  const above = i > 0 ? visibleOrder[i - 1] : null;
  const below = i >= 0 && i < visibleOrder.length - 1 ? visibleOrder[i + 1] : null;
  const rest = columnIds.filter((id) => id !== cardId);
  if (above !== null && rest.includes(above)) {
    rest.splice(rest.indexOf(above) + 1, 0, cardId);
    return rest;
  }
  if (below !== null && rest.includes(below)) {
    rest.splice(rest.indexOf(below), 0, cardId);
    return rest;
  }
  return [...columnIds];
}

/**
  The position a moved card is shown at until the server answers: the same
  midpoint the server will pick, so the card sorts where it was dropped.
*/
export function optimisticPosition(
  tasks: readonly TaskCard[],
  afterId: string | null,
  beforeId: string | null,
): number {
  const above = afterId ? (tasks.find((t) => t.id === afterId)?.position ?? null) : null;
  const below = beforeId ? (tasks.find((t) => t.id === beforeId)?.position ?? null) : null;
  return positionBetween(above, below);
}

/**
  Whether the card the server sent back sits between the neighbours it was
  dropped between. It does not when the server had to renumber the column to
  make room (or someone else moved a neighbour meanwhile); the caller then
  refetches rather than show a card out of order.
*/
export function landedBetween(
  tasks: readonly TaskCard[],
  card: TaskCard,
  afterId: string | null,
  beforeId: string | null,
): boolean {
  const above = afterId ? tasks.find((t) => t.id === afterId) : null;
  const below = beforeId ? tasks.find((t) => t.id === beforeId) : null;
  if (afterId && (!above || above.status !== card.status || !(above.position < card.position))) return false;
  if (beforeId && (!below || below.status !== card.status || !(card.position < below.position))) return false;
  return true;
}
