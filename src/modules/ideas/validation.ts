import { z } from "zod";
import { HIDDEN_CHARACTER, idSchema, storable } from "@/modules/tasks/validation";

/*
  Every input an Ideas write accepts. Like the board's (../tasks/validation.ts)
  nothing from the browser is trusted: strings are trimmed, bounded and
  checked for a NUL, which Postgres text cannot hold. Messages are shown to a
  person as they are.
*/

export const IDEA_TITLE_MAX = 200;
export const IDEA_BODY_MAX = 5_000;

const titleSchema = z
  .string()
  .trim()
  .min(1, "Give your idea a title.")
  .max(IDEA_TITLE_MAX, `Keep the title to ${IDEA_TITLE_MAX} characters or fewer.`)
  .refine(storable, HIDDEN_CHARACTER);

/** An idea's body is optional: the title can be the whole thought. */
const ideaBodySchema = z
  .string()
  .trim()
  .max(IDEA_BODY_MAX, `Keep it to ${IDEA_BODY_MAX.toLocaleString("en")} characters or fewer.`)
  .refine(storable, HIDDEN_CHARACTER);

/** A reply has nothing but its body, so it needs one. */
const replyBodySchema = ideaBodySchema.refine((body) => body.length > 0, "Write something before replying.");

export const shareIdeaSchema = z.object({ title: titleSchema, body: ideaBodySchema.default("") });
export type ShareIdeaData = z.output<typeof shareIdeaSchema>;

export const replySchema = z.object({ parentId: idSchema, body: replyBodySchema });
export type ReplyData = z.output<typeof replySchema>;

/**
  Only the fields present change. A title belongs to an idea only, and a
  reply's body may not be emptied; both are the service's to refuse, since
  only it knows which kind of post the id is.
*/
export const editIdeaSchema = z
  .object({ id: idSchema, title: titleSchema.optional(), body: ideaBodySchema.optional() })
  .refine((p) => p.title !== undefined || p.body !== undefined, { message: "There is nothing to change." });
export type EditIdeaData = z.output<typeof editIdeaSchema>;

/** `up` is the state wanted, not a toggle, so a double tap cannot undo itself. */
export const voteSchema = z.object({ id: idSchema, up: z.boolean() });
export type VoteData = z.output<typeof voteSchema>;
