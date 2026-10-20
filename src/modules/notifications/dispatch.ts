import { after } from "next/server";
import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { APP_SHORT_NAME } from "@/lib/brand";
import type { PendingActivity } from "@/modules/notifications/context";
import { notificationText, pendingToDTO, pickPushEntry } from "@/modules/notifications/text";

/*
  Push fan-out for a committed board write.

  boardWrite() hands over the activities the write recorded; everyone
  active except the person who did it gets one push per task touched,
  built from the group's most newsworthy entry (see text.ts). A bulk
  "archive everything in Done" is the one exception: it collapses into a
  single summary push instead of one per task.

  Push is best-effort by design. If the VAPID keys are not configured the
  bell still works and this quietly does nothing; a dead subscription
  (the push service answers 404/410) is deleted, never retried; and no
  failure here can fail or roll back the write that caused it — the write
  has already committed by the time this runs.
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
  const task = () => dispatchActivityNotifications(entries);
  try {
    after(task);
  } catch {
    void task();
  }
}

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
      prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, title: true } }),
      prisma.user.findMany({ select: { id: true, name: true } }),
      prisma.user.findMany({ where: { active: true }, select: { id: true } }),
    ]);
    const titleOf = new Map(tasks.map((t) => [t.id, t.title]));
    const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "Someone";
    const recipientIds = recipients.map((r) => r.id).filter((id) => !actorIds.includes(id));
    if (recipientIds.length === 0) return;

    const subs = await prisma.pushSubscription.findMany({
      where: { userId: { in: recipientIds } },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (subs.length === 0) return;

    const now = new Date();
    const bulkArchive =
      groups.size > 1 && entries.every((e) => e.type === "archived");
    const payloads: Array<{ body: string; tag: string; url: string }> = bulkArchive
      ? [
          {
            body: `${nameOf(entries[0]!.actorId)} archived ${taskIds.length} completed tasks`,
            tag: "bulk-archive",
            url: "/",
          },
        ]
      : [...groups.values()].map((group) => {
          const entry = pickPushEntry(group);
          const taskId = entry.taskId;
          return {
            body: notificationText(
              nameOf(entry.actorId),
              pendingToDTO(entry, now),
              titleOf.get(taskId) ?? "a task",
              nameOf,
            ),
            tag: taskId,
            url: `/?task=${taskId}`,
          };
        });

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
  } catch (err) {
    console.error("push dispatch failed", err);
  }
}
