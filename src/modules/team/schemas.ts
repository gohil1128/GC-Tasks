import { z } from "zod";
import { isAnimalKey } from "@/lib/avatars";
import { isColorKey } from "@/lib/colors";
import { ROLES } from "@/lib/permissions";

/*
  The shape of every input the team and account forms accept. A Server Action
  is a public endpoint, so nothing the browser sends is trusted: strings are
  trimmed and bounded, emails are lowercased (one address, one account, however
  it was typed), and colours and roles must be ones the app knows.

  No server-only imports, so a form can share the same limits. Messages are
  written to be shown to a person as they are.
*/

export const NAME_MAX = 80;
export const EMAIL_MAX = 254;

export const memberIdSchema = z
  .string({ message: "That teammate could not be found." })
  .min(1, "That teammate could not be found.")
  .max(64, "That teammate could not be found.");

// Postgres text cannot hold a NUL, so one would get past every check here and
// then fail the write itself. Emails need nothing extra: .email() never lets
// one through.
export const nameSchema = z
  .string({ message: "Enter a name." })
  .trim()
  .min(1, "Enter a name.")
  .max(NAME_MAX, `Keep the name to ${NAME_MAX} characters or fewer.`)
  .refine(
    (s) => !s.includes("\u0000"),
    "That name contains a hidden character that can't be saved. Retype it and try again.",
  );

export const emailSchema = z
  .string({ message: "Enter an email address." })
  .trim()
  .toLowerCase()
  .min(1, "Enter an email address.")
  .max(EMAIL_MAX, "That email address is too long.")
  .email("Enter a valid email address.");

export const roleSchema = z.enum(ROLES, { message: "Choose Owner or Staff." });

export const colorSchema = z
  .string({ message: "Pick one of the colours shown." })
  .refine(isColorKey, "Pick one of the colours shown.");

export const addMemberSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  role: roleSchema,
});

export const animalSchema = z
  .string({ message: "Pick one of the animals shown." })
  .refine(isAnimalKey, "Pick one of the animals shown.");

export const profileSchema = z.object({
  name: nameSchema,
  color: colorSchema,
  // Optional so older callers keep working; the profile form always sends
  // the animal it shows (the pick, or the seeded default it renders).
  avatar: animalSchema.optional(),
});

export const activeSchema = z.boolean({ message: "Say whether the account should be active." });

/** The first problem with an input, as a sentence for the person who typed it. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again.";
}
