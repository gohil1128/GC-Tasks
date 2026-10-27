import { prisma } from "@/lib/prisma";
import { notificationSentence } from "@/modules/notifications/text";
import type { ActivityDTO, ActivityType } from "@/modules/tasks/types";

/*
  One person's changes across the whole board, newest first — what an owner
  sees on a teammate's profile (/team/[id]). It is the same Activity table
  the task history and the bell read, filtered by who made the change.

  Owners only, and owners see every task, so nothing here is filtered by
  task visibility: callers check canManageTeam first.
*/

export const MEMBER_ACTIVITY_LIMIT = 100;

export type MemberActivityItem = {
  id: string;
  type: ActivityType;
  text: string;
  taskId: string;
  taskTitle: string;
  taskArchived: boolean;
  createdAt: string;
};

export type MemberProfile = {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "STAFF";
  active: boolean;
  color: string;
  avatar: string | null;
  createdAt: string;
  activity: MemberActivityItem[];
  /** Every change they have made, not just the ones listed. */
  totalChanges: number;
};

export async function getMemberProfile(memberId: string): Promise<MemberProfile | null> {
  const member = await prisma.user.findUnique({
    where: { id: memberId },
    select: { id: true, name: true, email: true, role: true, active: true, color: true, avatar: true, createdAt: true },
  });
  if (!member) return null;

  const [rows, totalChanges, people] = await Promise.all([
    prisma.activity.findMany({
      where: { actorId: memberId },
      orderBy: { createdAt: "desc" },
      take: MEMBER_ACTIVITY_LIMIT,
      select: {
        id: true,
        actorId: true,
        type: true,
        detail: true,
        createdAt: true,
        taskId: true,
        task: { select: { title: true, archivedAt: true } },
      },
    }),
    prisma.activity.count({ where: { actorId: memberId } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const nameOf = (id: string) => nameById.get(id) ?? "Someone";

  return {
    ...member,
    createdAt: member.createdAt.toISOString(),
    totalChanges,
    activity: rows.map((row) => {
      const dto: ActivityDTO = {
        id: row.id,
        actorId: row.actorId,
        type: row.type as ActivityType,
        detail: (row.detail ?? {}) as Record<string, unknown>,
        createdAt: row.createdAt.toISOString(),
      };
      return {
        id: row.id,
        type: dto.type,
        text: notificationSentence(dto, nameOf),
        taskId: row.taskId,
        taskTitle: row.task.title,
        taskArchived: row.task.archivedAt !== null,
        createdAt: dto.createdAt,
      };
    }),
  };
}
