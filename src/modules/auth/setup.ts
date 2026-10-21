import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { colorForSeed, type ColorKey } from "@/lib/colors";
import { hashPassword, passwordSchema } from "@/modules/auth/password";
import type { ActionResult, Member } from "@/modules/tasks/types";
import { emailSchema, firstIssue, nameSchema } from "@/modules/team/schemas";
import { bumpRevision, lockTeam, toMember } from "@/modules/team/service";

/*
  First run. A fresh deployment has nobody in it, so the very first visitor
  creates the first owner — and from then on this door is shut, because
  otherwise anyone who found /setup could make themselves an owner.

  "Shut" is decided inside the transaction, under the same team lock every
  other change to the team takes: two people opening a fresh deployment at
  the same moment cannot both count zero and both get in.
*/

export const STARTER_LABELS: { name: string; color: ColorKey }[] = [
  { name: "Kitchen", color: "amber" },
  { name: "Marketing", color: "rust" },
  { name: "Admin", color: "slate" },
  { name: "Events", color: "teal" },
  { name: "Supplies", color: "olive" },
];

export const setupSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "The two passwords don't match.",
    path: ["confirmPassword"],
  });

export const ALREADY_SET_UP = "This board is already set up. Sign in instead.";

/** True once anybody has an account — the board is set up. */
export async function hasAnyUser(): Promise<boolean> {
  return (await prisma.user.count()) > 0;
}

/**
  Creates the first account as an OWNER who chose their own password, along
  with a few starter labels so the board does not open empty of them.
  FORBIDDEN once anyone exists.
*/
export async function createFirstOwner(input: unknown): Promise<ActionResult<Member>> {
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID", error: firstIssue(parsed.error) };
  const { name, email, password } = parsed.data;
  const passwordHash = await hashPassword(password);

  return prisma.$transaction(async (tx) => {
    await lockTeam(tx);
    if ((await tx.user.count()) > 0) {
      return { ok: false as const, code: "FORBIDDEN" as const, error: ALREADY_SET_UP };
    }
    const row = await tx.user.create({
      data: { name, email, passwordHash, role: "OWNER", mustChangePassword: false, color: colorForSeed(email) },
      select: { id: true, name: true, email: true, color: true, avatar: true, role: true, active: true },
    });
    // skipDuplicates: a database that once had people in it may still have labels.
    await tx.label.createMany({ data: STARTER_LABELS, skipDuplicates: true });
    const revision = await bumpRevision(tx);
    return { ok: true as const, data: toMember(row), revision };
  });
}
