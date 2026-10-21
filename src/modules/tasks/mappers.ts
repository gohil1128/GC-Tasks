import type { Prisma } from "@prisma/client";
import { formatDay } from "@/lib/dates";
import type {
  ActivityDTO,
  ActivityType,
  ArchivedTask,
  ChecklistItemDTO,
  CommentDTO,
  LabelDTO,
  BoardMember,
  TaskCard,
} from "@/modules/tasks/types";

/*
  Database rows → the plain-JSON shapes in types.ts. Each select and its
  mapper sit together so the board read, the detail read and every write's
  return value build a card the same way — there is one definition of what a
  card is.
*/

// ── Cards ──────────────────────────────────────────────────────────────────

export const taskCardSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  position: true,
  priority: true,
  dueDate: true,
  version: true,
  completedAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  updatedById: true,
  // Ties on assignedAt (several added in one save) fall back to a stable order.
  assignees: { select: { userId: true }, orderBy: [{ assignedAt: "asc" }, { userId: "asc" }] },
  labels: { select: { labelId: true }, orderBy: { label: { name: "asc" } } },
  // Just the flags: a card needs "3/5", and a handful of booleans per task is
  // cheaper than a second grouped query. Prisma fetches these for every task
  // in one IN (...) query, not one per card.
  checklist: { select: { done: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.TaskSelect;

export type TaskCardRow = Prisma.TaskGetPayload<{ select: typeof taskCardSelect }>;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

export function toTaskCard(row: TaskCardRow): TaskCard {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    position: row.position,
    priority: row.priority,
    dueDate: row.dueDate ? formatDay(row.dueDate) : null,
    version: row.version,
    completedAt: isoOrNull(row.completedAt),
    archivedAt: isoOrNull(row.archivedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    createdById: row.createdById,
    updatedById: row.updatedById,
    assigneeIds: row.assignees.map((a) => a.userId),
    labelIds: row.labels.map((l) => l.labelId),
    checklistDone: row.checklist.filter((c) => c.done).length,
    checklistTotal: row.checklist.length,
    commentCount: row._count.comments,
  };
}

// ── Archived list ──────────────────────────────────────────────────────────

export const archivedTaskSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  archivedAt: true,
  assignees: taskCardSelect.assignees,
  labels: taskCardSelect.labels,
} satisfies Prisma.TaskSelect;

export function toArchivedTask(row: Prisma.TaskGetPayload<{ select: typeof archivedTaskSelect }>): ArchivedTask {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    archivedAt: isoOrNull(row.archivedAt),
    assigneeIds: row.assignees.map((a) => a.userId),
    labelIds: row.labels.map((l) => l.labelId),
  };
}

// ── People and labels ──────────────────────────────────────────────────────

/**
  This goes to every browser on the board, staff included: never the password
  hash, and not the email either (see BoardMember).
*/
export const boardMemberSelect = {
  id: true,
  name: true,
  color: true,
  avatar: true,
  role: true,
  active: true,
} satisfies Prisma.UserSelect;

export function toBoardMember(row: Prisma.UserGetPayload<{ select: typeof boardMemberSelect }>): BoardMember {
  return { id: row.id, name: row.name, color: row.color, avatar: row.avatar, role: row.role, active: row.active };
}

export const labelSelect = { id: true, name: true, color: true } satisfies Prisma.LabelSelect;

export function toLabel(row: Prisma.LabelGetPayload<{ select: typeof labelSelect }>): LabelDTO {
  return { id: row.id, name: row.name, color: row.color };
}

// ── Detail parts ───────────────────────────────────────────────────────────

export const checklistItemSelect = {
  id: true,
  text: true,
  done: true,
  position: true,
} satisfies Prisma.ChecklistItemSelect;

export function toChecklistItem(
  row: Prisma.ChecklistItemGetPayload<{ select: typeof checklistItemSelect }>,
): ChecklistItemDTO {
  return { id: row.id, text: row.text, done: row.done, position: row.position };
}

export const commentSelect = {
  id: true,
  authorId: true,
  body: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CommentSelect;

export function toComment(row: Prisma.CommentGetPayload<{ select: typeof commentSelect }>): CommentDTO {
  return {
    id: row.id,
    authorId: row.authorId,
    body: row.body,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export const activitySelect = {
  id: true,
  actorId: true,
  type: true,
  detail: true,
  createdAt: true,
} satisfies Prisma.ActivitySelect;

export function toActivity(row: Prisma.ActivityGetPayload<{ select: typeof activitySelect }>): ActivityDTO {
  const detail =
    row.detail && typeof row.detail === "object" && !Array.isArray(row.detail)
      ? (row.detail as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    actorId: row.actorId,
    // Written only by this module's service with an ActivityType;
    // describeActivity() copes with anything unrecognised.
    type: row.type as ActivityType,
    detail,
    createdAt: iso(row.createdAt),
  };
}
