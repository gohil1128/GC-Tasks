"use server";
import * as ideas from "@/modules/ideas/service";
import type { DeleteIdeaResult, VoteResult } from "@/modules/ideas/types";
import { editIdeaSchema, replySchema, shareIdeaSchema, voteSchema } from "@/modules/ideas/validation";
import { asActor, withInput } from "@/modules/tasks/session";
import type { ActionResult } from "@/modules/tasks/types";
import { idSchema } from "@/modules/tasks/validation";

/*
  Permissions (src/lib/permissions.ts), enforced in ./service.ts against the
  post and the person as they stand inside the transaction:
    anyone active: share an idea, reply anywhere, upvote others' posts once
    edit: the author only
    delete: the author, or any owner
  A refusal is { ok:false, code:"FORBIDDEN" }.
*/

export async function shareIdeaAction(input: { title: string; body?: string }): Promise<ActionResult<{ id: string }>> {
  return asActor((actor) => withInput(shareIdeaSchema, input, (data) => ideas.shareIdea(actor, data)));
}

/** `parentId` is the idea itself or any reply under it. */
export async function replyToIdeaAction(
  parentId: string,
  body: string,
): Promise<ActionResult<{ id: string; rootId: string }>> {
  return asActor((actor) => withInput(replySchema, { parentId, body }, (data) => ideas.replyToIdea(actor, data)));
}

/** Only the fields present change; a title is an idea's alone. */
export async function editIdeaAction(input: {
  id: string;
  title?: string;
  body?: string;
}): Promise<ActionResult<{ id: string }>> {
  // Picked field by field: `input` comes off the wire and may not be an object at all.
  const raw = { id: input?.id, title: input?.title, body: input?.body };
  return asActor((actor) => withInput(editIdeaSchema, raw, (data) => ideas.editIdea(actor, data)));
}

/** Kept as "[deleted]" while it has replies, removed outright when it has none. */
export async function deleteIdeaAction(id: string): Promise<ActionResult<DeleteIdeaResult>> {
  return asActor((actor) => withInput(idSchema, id, (postId) => ideas.deleteIdea(actor, postId)));
}

/** `up` is the state wanted — true to upvote, false to take it back. */
export async function setVoteAction(id: string, up: boolean): Promise<ActionResult<VoteResult>> {
  return asActor((actor) => withInput(voteSchema, { id, up }, (data) => ideas.setVote(actor, data)));
}
