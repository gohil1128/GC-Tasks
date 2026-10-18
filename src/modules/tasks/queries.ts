// Server-only reads. Callers are responsible for checking the session first.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  activitySelect,
  archivedTaskSelect,
  checklistItemSelect,
  commentSelect,
  labelSelect,
  boardMemberSelect,
  taskCardSelect,
  toActivity,
  toArchivedTask,
  toChecklistItem,
  toComment,
  toLabel,
  toBoardMember,
  toTaskCard,
} from "@/modules/tasks/mappers";
import { readRevision } from "@/modules/tasks/revision";
import type { ArchivedTask, BoardData, TaskDetail } from "@/modules/tasks/types";

// The one card shape, shared with the actions' return values.
export { toTaskCard };

type Db = Prisma.TransactionClient | typeof prisma;

/*
  Owners and staff get the same data: staff see the whole board, and what
  they may DO with it is decided per action (src/lib/permissions.ts).
*/

/**
  The whole board in one consistent snapshot. Read under REPEATABLE READ so
  the revision and the tasks describe the same moment — read separately, a
  write landing in between could pair new tasks with an old revision (a
  wasted refetch) or, worse, old tasks with a new revision (a missed one).
*/
export async function getBoard(): Promise<BoardData> {
  const [revision, tasks, members, labels] = await prisma.$transaction(
    [
      prisma.boardRevision.findUnique({ where: { id: 1 }, select: { revision: true } }),
      prisma.task.findMany({
        where: { archivedAt: null },
        select: taskCardSelect,
        // Postgres orders an enum by declaration: TODO, IN_PROGRESS, DONE.
        orderBy: [{ status: "asc" }, { position: "asc" }, { id: "asc" }],
      }),
      prisma.user.findMany({ select: boardMemberSelect, orderBy: [{ name: "asc" }, { id: "asc" }] }),
      prisma.label.findMany({ select: labelSelect, orderBy: { name: "asc" } }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return {
    revision: revision?.revision ?? 0,
    tasks: tasks.map(toTaskCard),
    members: members.map(toBoardMember),
    labels: labels.map(toLabel),
  };
}

export async function getRevision(): Promise<number> {
  return readRevision();
}

/** The detail read, against any client so a write can use it inside its transaction. */
export async function readTaskDetail(db: Db, id: string): Promise<TaskDetail | null> {
  const row = await db.task.findUnique({
    where: { id },
    select: {
      ...taskCardSelect,
      // The full items instead of the card's bare done flags; the card's
      // counts are worked out from these just the same.
      checklist: { select: checklistItemSelect, orderBy: [{ position: "asc" }, { id: "asc" }] },
      comments: { select: commentSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      activity: { select: activitySelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 },
    },
  });
  if (!row) return null;
  return {
    ...toTaskCard(row),
    checklist: row.checklist.map(toChecklistItem),
    comments: row.comments.map(toComment),
    activity: row.activity.map(toActivity),
  };
}

/** null when the task does not exist. Archived tasks are returned too. */
export async function getTaskDetail(id: string): Promise<TaskDetail | null> {
  return readTaskDetail(prisma, id);
}

/** Newest-archived first. */
export async function getArchivedTasks(): Promise<ArchivedTask[]> {
  const rows = await prisma.task.findMany({
    where: { archivedAt: { not: null } },
    select: archivedTaskSelect,
    orderBy: [{ archivedAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toArchivedTask);
}
