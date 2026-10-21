/*
  The shapes the board passes between server and browser. Everything here is
  plain JSON — dates are ISO strings, due dates are "YYYY-MM-DD" — so the same
  type describes a Server Action's return value and a route handler's body.

  No server-only imports: client components import this file.
*/

import type { Role } from "@/lib/permissions";

export const STATUSES = ["TODO", "IN_PROGRESS", "DONE"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

/** A teammate, as the owners-only Team page sees them. */
export type Member = {
  id: string;
  name: string;
  email: string;
  color: string;
  /** Their animal pick from the chai club (src/lib/avatars.ts); null = seeded default. */
  avatar: string | null;
  role: Role;
  active: boolean;
};

/**
  A teammate as the board sees them: everything a card, a picker or a filter
  needs, and not their email. The board goes to every account, staff
  included, and an email list of the whole team — leavers too — is the Team
  page's to show, which only owners can open. Deactivated members still
  appear so old cards keep their names.
*/
export type BoardMember = Omit<Member, "email">;

export type LabelDTO = {
  id: string;
  name: string;
  color: string;
};

/** Everything a card on the board needs, and nothing it does not. */
export type TaskCard = {
  id: string;
  title: string;
  description: string;
  status: Status;
  position: number;
  priority: Priority;
  /** "YYYY-MM-DD" or null. */
  dueDate: string | null;
  version: number;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdById: string;
  updatedById: string;
  /** In the order they were assigned. */
  assigneeIds: string[];
  /** Sorted by label name. */
  labelIds: string[];
  checklistDone: number;
  checklistTotal: number;
  commentCount: number;
};

export type BoardData = {
  /** The board's revision when this was read; see BoardRevision in the schema. */
  revision: number;
  /** Every non-archived task, sorted by status then position. */
  tasks: TaskCard[];
  /** Every account, active or not, sorted by name. */
  members: BoardMember[];
  /** Every label, sorted by name. */
  labels: LabelDTO[];
};

export type ChecklistItemDTO = {
  id: string;
  text: string;
  done: boolean;
  position: number;
};

export type CommentDTO = {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type ActivityType =
  | "created"
  | "moved"
  | "edited"
  | "assigned"
  | "unassigned"
  | "labels_changed"
  | "due_changed"
  | "priority_changed"
  | "commented"
  | "checklist_added"
  | "checklist_checked"
  | "checklist_unchecked"
  | "checklist_removed"
  | "archived"
  | "restored";

export type ActivityDTO = {
  id: string;
  actorId: string;
  type: ActivityType;
  /**
    Type-specific, all optional:
      moved: { from: Status, to: Status }
      edited: { fields: string[] }          ("title" | "description")
      assigned / unassigned: { userIds: string[] }
      labels_changed: { added: string[], removed: string[] }   (label NAMES, so
        a later-deleted label still reads)
      due_changed: { from: string | null, to: string | null }
      priority_changed: { from: Priority, to: Priority }
      checklist_*: { text: string }
  */
  detail: Record<string, unknown>;
  createdAt: string;
};

/** The full task, for the detail dialog. */
export type TaskDetail = TaskCard & {
  checklist: ChecklistItemDTO[];
  /** Oldest first. */
  comments: CommentDTO[];
  /** Newest first, at most 50. */
  activity: ActivityDTO[];
};

export type ArchivedTask = Pick<
  TaskCard,
  "id" | "title" | "status" | "priority" | "assigneeIds" | "labelIds" | "archivedAt"
>;

export type ErrorCode =
  | "INVALID"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "PASSWORD_CHANGE_REQUIRED";

/**
  What every board Server Action returns.

  FORBIDDEN means signed in but not allowed — a staff account trying an
  owner's action, or working a task it is not on (src/lib/permissions.ts). Actions never throw at the browser
  for an expected failure: a bad input, a stale edit or a vanished task is a
  value the UI can show. `revision` is the board revision after the write, so
  the caller can skip the refetch its own write would otherwise trigger.

  A CONFLICT on updateTask carries the task as it now stands, so the dialog
  can show what changed instead of just failing.
*/
export type ActionResult<T> =
  | { ok: true; data: T; revision: number }
  | { ok: false; code: ErrorCode; error: string; current?: TaskDetail };

// ── Inputs ────────────────────────────────────────────────────────────────

export type CreateTaskInput = {
  title: string;
  description?: string;
  status?: Status;
  priority?: Priority;
  dueDate?: string | null;
  assigneeIds?: string[];
  labelIds?: string[];
};

/**
  Only the fields present are changed. `version` is the version the editor
  started from; if the task has moved on since, nothing is written and the
  result is a CONFLICT.
*/
export type UpdateTaskInput = {
  id: string;
  version: number;
  title?: string;
  description?: string;
  priority?: Priority;
  dueDate?: string | null;
  assigneeIds?: string[];
  labelIds?: string[];
};

/**
  Drop a card into `status`, between the card that will sit above it
  (`afterId`, null for the top) and the one below it (`beforeId`, null for
  the bottom). Neighbours rather than an index, so two people dragging at once
  do not fight over what "position 3" means.
*/
export type MoveTaskInput = {
  id: string;
  status: Status;
  afterId: string | null;
  beforeId: string | null;
};
