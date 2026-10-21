import { prisma } from "@/lib/prisma";
import { notificationSentence } from "@/modules/notifications/text";
import type { ActivityDTO, ActivityType } from "@/modules/tasks/types";

/*
  The bell's reads and writes. The feed is not a second copy of the board's
  history: it IS the Activity table, read across all tasks, newest first,
  leaving out the reader's own changes (being told about your own edit is
  noise). "Unread" is a watermark on the account — activity by other
  people newer than notificationReadAt (or than the account itself, for
  accounts that predate the watermark and have never opened the bell).
*/

export type NotificationItem = {
  id: string;
  actorId: string;
  actorName: string;
  actorColor: string;
  actorAvatar: string | null;
  type: ActivityType;
  text: string;
  taskId: string;
  taskTitle: string;
  taskArchived: boolean;
  createdAt: string;
  unread: boolean;
};

export type NotificationFeed = {
  items: NotificationItem[];
  unread: number;
  /** The Web Push public key, when push is configured on this deployment. */
  pushPublicKey: string | null;
};

const FEED_LIMIT = 40;

async function readWatermark(userId: string): Promise<Date> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationReadAt: true, createdAt: true },
  });
  return me?.notificationReadAt ?? me?.createdAt ?? new Date(0);
}

export async function getNotificationFeed(userId: string): Promise<NotificationFeed> {
  const since = await readWatermark(userId);
  const [rows, unread, people] = await Promise.all([
    prisma.activity.findMany({
      where: { actorId: { not: userId } },
      orderBy: { createdAt: "desc" },
      take: FEED_LIMIT,
      select: {
        id: true,
        actorId: true,
        type: true,
        detail: true,
        createdAt: true,
        taskId: true,
        actor: { select: { name: true, color: true, avatar: true } },
        task: { select: { title: true, archivedAt: true } },
      },
    }),
    prisma.activity.count({ where: { actorId: { not: userId }, createdAt: { gt: since } } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const nameOf = (id: string) => nameById.get(id) ?? "Someone";

  const items: NotificationItem[] = rows.map((row) => {
    const dto: ActivityDTO = {
      id: row.id,
      actorId: row.actorId,
      type: row.type as ActivityType,
      detail: (row.detail ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
    };
    return {
      id: row.id,
      actorId: row.actorId,
      actorName: row.actor.name,
      actorColor: row.actor.color,
      actorAvatar: row.actor.avatar,
      type: dto.type,
      text: notificationSentence(dto, nameOf),
      taskId: row.taskId,
      taskTitle: row.task.title,
      taskArchived: row.task.archivedAt !== null,
      createdAt: dto.createdAt,
      unread: row.createdAt > since,
    };
  });

  return {
    items,
    unread,
    pushPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
  };
}

/** The bell was opened: everything up to now counts as read. */
export async function markNotificationsRead(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { notificationReadAt: new Date() },
    select: { id: true },
  });
}

export type PushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
};

/** One row per device endpoint; re-subscribing the same device updates it. */
export async function savePushSubscription(
  userId: string,
  input: PushSubscriptionInput,
): Promise<void> {
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: { userId, ...input },
    update: { userId, p256dh: input.p256dh, auth: input.auth, userAgent: input.userAgent },
    select: { id: true },
  });
}

export async function removePushSubscription(userId: string, endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
}
