import { describeActivity } from "@/modules/tasks/activity";
import type { ActivityDTO, ActivityType } from "@/modules/tasks/types";
import type { PendingActivity } from "@/modules/notifications/context";

/*
  How an activity reads as a notification — shared by the bell feed (which
  renders stored Activity rows) and the push dispatcher (which renders the
  entries a write just captured). Pure and client-safe, like activity.ts.
*/

/**
 * The activity's sentence, with one wording change from the task history:
 * a move INTO Done is the board's "finished" moment, so it says so —
 * "completed this task" instead of "moved this from In progress to Done".
 */
export function notificationSentence(
  activity: ActivityDTO,
  nameOf: (id: string) => string,
): string {
  if (activity.type === "moved" && activity.detail?.to === "DONE") {
    return "completed this task";
  }
  return describeActivity(activity, nameOf);
}

/** "Het completed this task — Order cups" — the one-line notification text. */
export function notificationText(
  actorName: string,
  activity: ActivityDTO,
  taskTitle: string,
  nameOf: (id: string) => string,
): string {
  return `${actorName} ${notificationSentence(activity, nameOf)} — ${taskTitle}`;
}

/*
  One board write can record several activities for the same task (one
  save: edited + assigned + due_changed). The bell lists them all, but a
  phone gets ONE push per task per write — the most newsworthy entry,
  ranked here. Completions rank near the top on purpose: the team asked
  to hear about finished tasks, not just new ones.
*/
const PUSH_RANK: Record<ActivityType, number> = {
  created: 100,
  moved: 90, // lifted further below when the move completes the task
  commented: 80,
  assigned: 70,
  unassigned: 60,
  priority_changed: 50,
  due_changed: 40,
  edited: 30,
  labels_changed: 20,
  checklist_added: 15,
  checklist_checked: 14,
  checklist_unchecked: 13,
  checklist_removed: 12,
  archived: 10,
  restored: 10,
};

function pushRank(entry: PendingActivity): number {
  if (entry.type === "moved" && entry.detail?.to === "DONE") return 95;
  return PUSH_RANK[entry.type] ?? 0;
}

/** The single entry of a same-task group that the push is built from. */
export function pickPushEntry(entries: PendingActivity[]): PendingActivity {
  let best = entries[0]!;
  for (const entry of entries) {
    if (pushRank(entry) > pushRank(best)) best = entry;
  }
  return best;
}

/** A captured entry as the DTO the wording helpers expect. */
export function pendingToDTO(entry: PendingActivity, createdAt: Date): ActivityDTO {
  return {
    id: "",
    actorId: entry.actorId,
    type: entry.type,
    detail: entry.detail,
    createdAt: createdAt.toISOString(),
  };
}
