import { z } from "zod";
import { isColorKey } from "@/lib/colors";
import { parseDay } from "@/lib/dates";
import { PRIORITIES, STATUSES, type ErrorCode } from "@/modules/tasks/types";

/*
  The shape of every input a board write accepts. A Server Action is a public
  endpoint, so nothing the browser sends is trusted: strings are trimmed and
  bounded, enums are checked, and due dates are parsed to UTC midnight here,
  once, so the service only ever sees clean values.

  Messages are written to be shown to a person as they are.
*/

/*
  Postgres text cannot hold a NUL (U+0000). One would pass every length check
  here and then fail the write itself — a database error and a crash instead
  of a sentence — so every string is checked for it, ids included: a NUL in a
  lookup fails the same way.
*/
export const HIDDEN_CHARACTER = "That contains a hidden character that can't be saved. Retype it and try again.";
export function storable(value: string): boolean {
  return !value.includes("\u0000");
}

export const idSchema = z
  .string()
  .min(1, "Something is missing from that request.")
  .max(64, "That id is not valid.")
  .refine(storable, HIDDEN_CHARACTER);

const idList = z
  .array(idSchema)
  .max(100, "That is too many to set at once.")
  .transform((ids) => [...new Set(ids)]);

export const statusSchema = z.enum(STATUSES, { message: "That is not one of the board's columns." });
export const prioritySchema = z.enum(PRIORITIES, { message: "That is not a priority." });

const titleSchema = z
  .string()
  .trim()
  .min(1, "Give the task a title.")
  .max(200, "Keep the title to 200 characters or fewer.")
  .refine(storable, HIDDEN_CHARACTER);

const descriptionSchema = z
  .string()
  .trim()
  .max(10_000, "Keep the description to 10,000 characters or fewer.")
  .refine(storable, HIDDEN_CHARACTER);

/** "YYYY-MM-DD" → that day at UTC midnight; null or "" → no due date. */
const dueDateSchema = z.union([z.string(), z.null()]).transform((value, ctx): Date | null => {
  if (value === null || value.trim() === "") return null;
  const day = parseDay(value);
  if (!day) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "That due date is not a real day." });
    return z.NEVER;
  }
  return day;
});

export const createTaskSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.default(""),
  status: statusSchema.default("TODO"),
  priority: prioritySchema.default("MEDIUM"),
  dueDate: dueDateSchema.optional().transform((d) => d ?? null),
  assigneeIds: idList.default([]),
  labelIds: idList.default([]),
});
export type CreateTaskData = z.output<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  id: idSchema,
  version: z.number().int().min(1, "That version is not valid."),
  title: titleSchema.optional(),
  description: descriptionSchema.optional(),
  priority: prioritySchema.optional(),
  dueDate: dueDateSchema.optional(),
  assigneeIds: idList.optional(),
  labelIds: idList.optional(),
});
export type UpdateTaskData = z.output<typeof updateTaskSchema>;

export const moveTaskSchema = z.object({
  id: idSchema,
  status: statusSchema,
  // Tolerate a missing neighbour as "none" rather than refusing the drop.
  afterId: idSchema.nullish().transform((v) => v ?? null),
  beforeId: idSchema.nullish().transform((v) => v ?? null),
});
export type MoveTaskData = z.output<typeof moveTaskSchema>;

export const checklistTextSchema = z
  .string()
  .trim()
  .min(1, "Checklist items need some text.")
  .max(300, "Keep checklist items to 300 characters or fewer.")
  .refine(storable, HIDDEN_CHARACTER);

export const addChecklistItemSchema = z.object({ taskId: idSchema, text: checklistTextSchema });
export type AddChecklistItemData = z.output<typeof addChecklistItemSchema>;

export const updateChecklistItemSchema = z
  .object({
    id: idSchema,
    text: checklistTextSchema.optional(),
    done: z.boolean().optional(),
  })
  .refine((p) => p.text !== undefined || p.done !== undefined, { message: "There is nothing to change." });
export type UpdateChecklistItemData = z.output<typeof updateChecklistItemSchema>;

export const commentBodySchema = z
  .string()
  .trim()
  .min(1, "Write something before posting.")
  .max(5_000, "Keep comments to 5,000 characters or fewer.")
  .refine(storable, HIDDEN_CHARACTER);

export const addCommentSchema = z.object({ taskId: idSchema, body: commentBodySchema });
export type AddCommentData = z.output<typeof addCommentSchema>;

export const editCommentSchema = z.object({ id: idSchema, body: commentBodySchema });
export type EditCommentData = z.output<typeof editCommentSchema>;

const labelNameSchema = z
  .string()
  .trim()
  .min(1, "Give the label a name.")
  .max(80, "Keep label names to 80 characters or fewer.")
  .refine(storable, HIDDEN_CHARACTER);

const colorSchema = z
  .string()
  .trim()
  .refine((c) => isColorKey(c), { message: "Pick one of the colours on offer." });

export const createLabelSchema = z.object({ name: labelNameSchema, color: colorSchema });
export type CreateLabelData = z.output<typeof createLabelSchema>;

export const updateLabelSchema = z.object({
  id: idSchema,
  name: labelNameSchema.optional(),
  color: colorSchema.optional(),
});
export type UpdateLabelData = z.output<typeof updateLabelSchema>;

export type Parsed<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; error: string };

/**
  safeParse with the first problem as a sentence. A wrong TYPE (a number
  where text belongs) is not something a person typed, so it gets a generic
  line rather than zod's internals.
*/
export function parseInput<S extends z.ZodTypeAny>(schema: S, raw: unknown): Parsed<z.output<S>> {
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const issue = result.error.issues[0];
  const error =
    !issue || issue.code === z.ZodIssueCode.invalid_type
      ? "That request was not in the shape the board expects. Reload and try again."
      : issue.message;
  return { ok: false, code: "INVALID", error };
}
