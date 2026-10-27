import { after } from "next/server";
import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { APP_SHORT_NAME } from "@/lib/brand";
import { canSeeTask, type Actor } from "@/lib/permissions";
import { toVisibility, visibilitySelect } from "@/modules/tasks/visibility";
import type { PendingActivity } from "@/modules/notifications/context";
import {
  notificationText,
  pendingToDTO,
  pickPushEntry,
  teamEventSentence,
  type TeamEventType,
} from "@/modules/notifications/text";

/*
  Push fan-out for a committed board write.

  boardWrite() hands over the activities the write recorded; everyone
  active except the person who did it gets one push per task touched,
  built from the group's most newsworthy entry (see text.ts). A bulk
  "archive everything in Done" is the one exception: it collapses into a
  single summary push instead of one per task.

  Nobody is told about a task they cannot see (canSeeTask), judged as the
  task stands after the write — so assigning an owner to a task tells the
  staff who are not on it nothing, not even that.

  Push is best-effort by design. If the VAPID keys are not configured the
  bell still works and this quietly does nothing; a dead subscription
  (the push service answers 404/410) is deleted, never retried; and no
  failure here can fail or roll back the write that caused it — the write
  has already committed by the time this runs.

  Team events (somebody signing themselves up) go out the same way, but
  to active owners only; see scheduleTeamPush.
*/

let vapidReady: boolean | null = null;

function ensureVapid(): boolean {
  if (vapidReady !== null) return vapidReady;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    vapidReady = false;
    return vapidReady;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidReady = true;
  return vapidReady;
}

/**
 * Runs `task` once the response has been sent (Next's after()), so push
 * latency never sits in front of the person whose write caused it. Outside
 * a request scope after() throws — scripts, tests — and the task just runs.
 */
export function schedulePush(entries: PendingActivity[]): void {
  if (entries.length === 0) return;
  runAfter(() => dispatchActivityNotifications(entries));
}

/** The same, for a committed team event: active owners are told. */
export function scheduleTeamPush(event: { type: TeamEventType; userId: string; name: string }): void {
  runAfter(() => dispatchTeamNotification(event));
}

function runAfter(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

type Payload = { body: string; tag: string; url: string };

export async function dispatchActivityNotifications(entries: PendingActivity[]): Promise<void> {
  try {
    if (entries.length === 0 || !ensureVapid()) return;

    // Group the write's activities per (task, actor): one push per task.
    const groups = new Map<string, PendingActivity[]>();
    for (const entry of entries) {
      const key = `${entry.taskId}:${entry.actorId}`;
      const group = groups.get(key);
      if (group) group.push(entry);
      else groups.set(key, [entry]);
    }

    const taskIds = [...new Set(entries.map((e) => e.taskId))];
    const actorIds = [...new Set(entries.map((e) => e.actorId))];
    const [tasks, people, recipients] = await Promise.all([
      prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, title: true, ...visibilitySelect } }),
      prisma.user.findMany({ select: { id: true, name: true } }),
      prisma.user.findMany({ where: { active: true }, select: { id: true, role: true } }),
    ]);
    const titleOf = new Map(tasks.map((t) => [t.id, t.title]));
    const visibilityOf = new Map(tasks.map((t) => [t.id, toVisibility(t)]));
    const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "Someone";
    // A task deleted since the write is nobody's news.
    const sees = (who: Actor, taskId: string) => {
      const task = visibilityOf.get(taskId);
      return task !== undefined && canSeeTask(who, task);
    };
    const audience = recipients.filter((r) => !actorIds.includes(r.id));
    if (audience.length === 0) return;

    const now = new Date();
    const bulkArchive =
      groups.size > 1 && entries.every((e) => e.type === "archived");
    const perTask = [...groups.values()].map((group) => {
      const entry = pickPushEntry(group);
      const taskId = entry.taskId;
      return {
        taskId,
        payload: {
          body: notificationText(
            nameOf(entry.actorId),
            pendingToDTO(entry, now),
            titleOf.get(taskId) ?? "a task",
            nameOf,
          ),
          tag: taskId,
          url: `/?task=${taskId}`,
        },
      };
    });

    /** What one person is sent: only what they can see, and a bulk archive counts only those. */
    function payloadsFor(who: Actor): Payload[] {
      if (bulkArchive) {
        const count = taskIds.filter((id) => sees(who, id)).length;
        if (count === 0) return [];
        const body =
          count === 1
            ? `${nameOf(entries[0]!.actorId)} archived 1 completed task`
            : `${nameOf(entries[0]!.actorId)} archived ${count} completed tasks`;
        return [{ body, tag: "bulk-archive", url: "/" }];
      }
      return perTask.filter((p) => sees(who, p.taskId)).map((p) => p.payload);
    }

    await Promise.all(audience.map((who) => sendPushes([who.id], payloadsFor(who))));
  } catch (err) {
    console.error("push dispatch failed", err);
  }
}

export async function dispatchTeamNotification(event: {
  type: TeamEventType;
  userId: string;
  name: string;
}): Promise<void> {
  try {
    if (!ensureVapid()) return;
    const owners = await prisma.user.findMany({
      where: { role: "OWNER", active: true, id: { not: event.userId } },
      select: { id: true },
    });
    await sendPushes(
      owners.map((o) => o.id),
      [{ body: `${event.name} ${teamEventSentence(event.type)}`, tag: `team-${event.userId}`, url: "/team" }],
    );
  } catch (err) {
    console.error("push dispatch failed", err);
  }
}

/** Every payload to every device of these people; dead subscriptions are deleted. */
async function sendPushes(recipientIds: string[], payloads: Payload[]): Promise<void> {
  if (recipientIds.length === 0 || payloads.length === 0) return;
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: recipientIds } },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  if (subs.length === 0) return;

  const dead: string[] = [];
  await Promise.all(
    subs.flatMap((sub) =>
      payloads.map(async (payload) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: APP_SHORT_NAME, ...payload }),
          );
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) dead.push(sub.id);
          // Any other failure (a push service hiccup) is dropped, not
          // retried: the bell still carries the change.
        }
      }),
    ),
  );
  if (dead.length) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: [...new Set(dead)] } } });
  }
}
