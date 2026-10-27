import type { Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { visibleTaskWhere } from "@/modules/tasks/visibility";
import { notificationSentence, teamEventSentence } from "@/modules/notifications/text";
import type { ActivityDTO, ActivityType } from "@/modules/tasks/types";

/*
  The bell's reads and writes. The feed is not a second copy of the board's
  history: it IS the Activity table, read across all tasks, newest first,
  leaving out the reader's own changes (being told about your own edit is
  noise). "Unread" is a watermark on the account — activity by other
  people newer than notificationReadAt (or than the account itself, for
  accounts that predate the watermark and have never opened the bell).

  Only activity on tasks the reader can see counts, judged as the task
  stands now: once an owner is put on a task, its whole history leaves the
  bell of every staff member who is not on it too.

  Owners also get the team's own events (TeamEvent: somebody signing
  themselves up), merged into the same list by time and counted against
  the same watermark. Those carry no task: `kind` says which is which, and
  a team item's task fields are null. Who sees them is decided by the
  reader's role now, so an owner promoted later sees the team's history.
*/

export type NotificationItem = {
  kind: "task" | "team";
  id: string;
  actorId: string;
  actorName: string;
  actorColor: string;
  actorAvatar: string | null;
  /** An ActivityType for a task item, a TeamEventType for a team item. */
  type: string;
  text: string;
  taskId: string | null;
  taskTitle: string | null;
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

async function readReader(userId: string): Promise<{ since: Date; owner: boolean }> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationReadAt: true, createdAt: true, role: true },
  });
  return { since: me?.notificationReadAt ?? me?.createdAt ?? new Date(0), owner: me?.role === "OWNER" };
}

export async function getNotificationFeed(reader: Actor): Promise<NotificationFeed> {
  const userId = reader.id;
  const { since, owner } = await readReader(userId);
  const visible = { actorId: { not: userId }, task: visibleTaskWhere(reader) };
  const [rows, unread, people, team] = await Promise.all([
    prisma.activity.findMany({
      where: visible,
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
    prisma.activity.count({ where: { ...visible, createdAt: { gt: since } } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
    owner ? readTeamEvents(userId, since) : Promise.resolve({ items: [], unread: 0 }),
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
      kind: "task",
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

  // Both lists are newest first and at most FEED_LIMIT long, so the newest
  // FEED_LIMIT of the two together are all here.
  const merged = [...items, ...team.items]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, FEED_LIMIT);

  return {
    items: merged,
    unread: unread + team.unread,
    pushPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
  };
}

/** Owners only: team events about other people, newest first, and how many are unread. */
async function readTeamEvents(userId: string, since: Date): Promise<{ items: NotificationItem[]; unread: number }> {
  const [rows, unread] = await Promise.all([
    prisma.teamEvent.findMany({
      where: { userId: { not: userId } },
      orderBy: { createdAt: "desc" },
      take: FEED_LIMIT,
      select: {
        id: true,
        type: true,
        userId: true,
        createdAt: true,
        user: { select: { name: true, color: true, avatar: true } },
      },
    }),
    prisma.teamEvent.count({ where: { userId: { not: userId }, createdAt: { gt: since } } }),
  ]);
  return {
    unread,
    items: rows.map((row) => ({
      kind: "team",
      id: row.id,
      actorId: row.userId,
      actorName: row.user.name,
      actorColor: row.user.color,
      actorAvatar: row.user.avatar,
      type: row.type,
      text: teamEventSentence(row.type),
      taskId: null,
      taskTitle: null,
      taskArchived: false,
      createdAt: row.createdAt.toISOString(),
      unread: row.createdAt > since,
    })),
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
