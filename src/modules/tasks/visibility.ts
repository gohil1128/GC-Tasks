import type { Prisma } from "@prisma/client";
import { isOwner, type Actor } from "@/lib/permissions";

/*
  Which tasks a person may see, as a database filter: canSeeTask() in
  src/lib/permissions.ts, written as a Prisma `where` so lists are narrowed
  in the query rather than after it. The two must agree; the integration
  tests hold them to it.

  The roles are joined at read time, never copied onto the task, so a
  promotion or demotion changes what staff see on their next read.
*/

/** A `where` for Task: everything for owners; for staff, theirs or owner-free. */
export function visibleTaskWhere(actor: Actor): Prisma.TaskWhereInput {
  if (isOwner(actor)) return {};
  return {
    OR: [
      { assignees: { some: { userId: actor.id } } },
      { assignees: { none: { user: { role: "OWNER" } } } },
    ],
  };
}

/** The assignee rows canSeeTask() needs, for a select on Task. */
export const visibilitySelect = {
  assignees: { select: { userId: true, user: { select: { role: true } } } },
} satisfies Prisma.TaskSelect;

export function toVisibility(row: Prisma.TaskGetPayload<{ select: typeof visibilitySelect }>) {
  return { assignees: row.assignees.map((a) => ({ id: a.userId, role: a.user.role })) };
}
