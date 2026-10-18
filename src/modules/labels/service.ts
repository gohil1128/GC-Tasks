import { Prisma } from "@prisma/client";
import { canManageLabels, type Actor } from "@/lib/permissions";
import { labelSelect, toLabel } from "@/modules/tasks/mappers";
import { boardWrite, changed, refuse, unchanged, type Outcome } from "@/modules/tasks/revision";
import type { ActionResult, LabelDTO } from "@/modules/tasks/types";
import type { CreateLabelData, UpdateLabelData } from "@/modules/tasks/validation";

/*
  Labels are owners-only. Like every board write they run under the board
  lock and bump the revision, because cards show them.

  Names are unique ignoring case. The database's own unique index is
  case-sensitive, so the check is made here, inside the transaction — under
  the board lock no other write can slip a "kitchen" in between the check and
  the insert of "Kitchen".
*/

const ONLY_OWNERS = "Only owners can manage labels.";
const LABEL_GONE = "That label no longer exists.";
const NAME_TAKEN = "A label with that name already exists.";

/*
  lower() against lower() rather than Prisma's insensitive mode, which is
  ILIKE with the name as the pattern: "K_tchen" would clash with "Kitchen",
  and a backslash would let "a\b" past "A\B" or fail the query outright.
*/
async function assertNameFree(tx: Prisma.TransactionClient, name: string, exceptId?: string): Promise<void> {
  const others = exceptId ? Prisma.sql`AND "id" <> ${exceptId}` : Prisma.empty;
  const [clash] = await tx.$queryRaw<{ name: string }[]>`
    SELECT "name" FROM "Label" WHERE lower("name") = lower(${name}) ${others} LIMIT 1`;
  if (clash) refuse("INVALID", `A label called “${clash.name}” already exists.`);
}

/*
  Between label writes the board lock and assertNameFree leave the unique
  index nothing to catch. Something writing outside them (a script) still
  could, and that answers as a refusal rather than a crash.
*/
async function labelWrite<T>(
  actor: Actor,
  work: (tx: Prisma.TransactionClient) => Promise<Outcome<T>>,
): Promise<ActionResult<T>> {
  try {
    // The role is checked against the person as they are once the board lock
    // is held, so an owner demoted a moment ago cannot finish a label change.
    return await boardWrite(actor, async (tx, fresh) => {
      if (!canManageLabels(fresh)) refuse("FORBIDDEN", ONLY_OWNERS);
      return work(tx);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, code: "INVALID", error: NAME_TAKEN };
    }
    throw err;
  }
}

export async function createLabel(actor: Actor, input: CreateLabelData): Promise<ActionResult<LabelDTO>> {
  return labelWrite(actor, async (tx) => {
    await assertNameFree(tx, input.name);
    const label = await tx.label.create({ data: { name: input.name, color: input.color }, select: labelSelect });
    return changed(toLabel(label));
  });
}

/** Renaming to a different case of its own name ("kitchen" → "Kitchen") is allowed. */
export async function updateLabel(actor: Actor, input: UpdateLabelData): Promise<ActionResult<LabelDTO>> {
  return labelWrite(actor, async (tx) => {
    const label = await tx.label.findUnique({ where: { id: input.id }, select: labelSelect });
    if (!label) refuse("NOT_FOUND", LABEL_GONE);
    const rename = input.name !== undefined && input.name !== label.name;
    const recolor = input.color !== undefined && input.color !== label.color;
    if (!rename && !recolor) return unchanged(toLabel(label));
    if (rename) await assertNameFree(tx, input.name as string, label.id);
    const updated = await tx.label.update({
      where: { id: label.id },
      data: { ...(rename ? { name: input.name } : {}), ...(recolor ? { color: input.color } : {}) },
      select: labelSelect,
    });
    return changed(toLabel(updated));
  });
}

/**
  Removes the label from every task that carries it (the link rows cascade).
  Task histories keep reading correctly, because labels_changed activity
  records names, not ids.
*/
export async function deleteLabel(actor: Actor, id: string): Promise<ActionResult<{ id: string }>> {
  return labelWrite(actor, async (tx) => {
    const label = await tx.label.findUnique({ where: { id }, select: { id: true } });
    if (!label) refuse("NOT_FOUND", LABEL_GONE);
    await tx.label.delete({ where: { id }, select: { id: true } });
    return changed({ id });
  });
}
