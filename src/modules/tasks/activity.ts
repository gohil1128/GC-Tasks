import { shortDay } from "@/lib/dates";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  STATUSES,
  STATUS_LABEL,
  type ActivityDTO,
  type Priority,
  type Status,
} from "@/modules/tasks/types";

/*
  A task's history, rendered as the second half of a sentence whose subject
  is the person who did it: "Harsh" + " moved this from To do to In progress".

  Pure and client-safe — the task dialog imports it. The `detail` it reads
  was written by the server but comes back as untyped JSON, and old rows may
  predate a field, so every read is defensive and an unexpected shape falls
  back to a vaguer sentence rather than "undefined".

  The types and their detail (also documented on ActivityDTO):
    created                     {}
    moved                       { from: Status, to: Status }
    edited                      { fields: ("title" | "description")[] }
    assigned / unassigned       { userIds: string[] }
    labels_changed              { added: string[], removed: string[] }  — names
    due_changed                 { from: "YYYY-MM-DD" | null, to: … | null }
    priority_changed            { from: Priority, to: Priority }
    commented                   {}
    checklist_added / _checked / _unchecked / _removed   { text: string }
    archived / restored         {}
*/

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

function isPriority(value: unknown): value is Priority {
  return typeof value === "string" && (PRIORITIES as readonly string[]).includes(value);
}

/** "Riya", "Riya and Sam", "Riya, Sam and Ali". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function quoted(text: string | null): string {
  return text ? `“${text}”` : "an item";
}

function people(activity: ActivityDTO, nameOf: (id: string) => string): string[] {
  return strList(activity.detail.userIds).map((id) => (id === activity.actorId ? "themselves" : nameOf(id)));
}

/** True when the only person named is the actor, i.e. they picked it up or stepped off themselves. */
function onlySelf(activity: ActivityDTO): boolean {
  const ids = strList(activity.detail.userIds);
  return ids.length === 1 && ids[0] === activity.actorId;
}

function labelPhrase(verb: string, names: string[]): string {
  const list = joinNames(names);
  return `${verb} the ${list} ${names.length === 1 ? "label" : "labels"}`;
}

/**
  What happened, as words. `nameOf` turns a user id into a display name
  (deactivated people included). Dates are shown without a year when they
  fall in the year the change was made.
*/
export function describeActivity(activity: ActivityDTO, nameOf: (id: string) => string): string {
  const d = activity.detail ?? {};
  switch (activity.type) {
    case "created":
      return "created this task";

    case "moved": {
      if (isStatus(d.from) && isStatus(d.to)) {
        return `moved this from ${STATUS_LABEL[d.from]} to ${STATUS_LABEL[d.to]}`;
      }
      return isStatus(d.to) ? `moved this to ${STATUS_LABEL[d.to]}` : "moved this";
    }

    case "edited": {
      const fields = strList(d.fields).filter((f) => f === "title" || f === "description");
      if (fields.length === 0) return "edited this task";
      return `edited the ${joinNames(fields)}`;
    }

    case "assigned": {
      if (onlySelf(activity)) return "picked this up";
      const names = people(activity, nameOf);
      return names.length ? `assigned ${joinNames(names)}` : "changed who is on this";
    }

    case "unassigned": {
      if (onlySelf(activity)) return "stepped off this task";
      const names = people(activity, nameOf);
      return names.length ? `unassigned ${joinNames(names)}` : "changed who is on this";
    }

    case "labels_changed": {
      const added = strList(d.added);
      const removed = strList(d.removed);
      const parts: string[] = [];
      if (added.length) parts.push(labelPhrase("added", added));
      if (removed.length) parts.push(labelPhrase("removed", removed));
      return parts.length ? parts.join(" and ") : "changed the labels";
    }

    case "due_changed": {
      const to = str(d.to);
      const from = str(d.from);
      const asOf = activity.createdAt.slice(0, 10);
      if (!to) return "removed the due date";
      return `${from ? "changed" : "set"} the due date to ${shortDay(to, asOf)}`;
    }

    case "priority_changed": {
      if (isPriority(d.to)) {
        return isPriority(d.from)
          ? `changed the priority from ${PRIORITY_LABEL[d.from]} to ${PRIORITY_LABEL[d.to]}`
          : `set the priority to ${PRIORITY_LABEL[d.to]}`;
      }
      return "changed the priority";
    }

    case "commented":
      return "commented";

    case "checklist_added":
      return `added ${quoted(str(d.text))} to the checklist`;
    case "checklist_checked":
      return `checked ${quoted(str(d.text))}`;
    case "checklist_unchecked":
      return `unchecked ${quoted(str(d.text))}`;
    case "checklist_removed":
      return `removed ${quoted(str(d.text))} from the checklist`;

    case "archived":
      return "archived this task";
    case "restored":
      return "restored this task";

    default:
      return "updated this task";
  }
}
