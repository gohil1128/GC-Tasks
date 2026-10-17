"use server";
import * as labels from "@/modules/labels/service";
import { asActor, withInput } from "@/modules/tasks/session";
import type { ActionResult, LabelDTO } from "@/modules/tasks/types";
import { createLabelSchema, idSchema, updateLabelSchema } from "@/modules/tasks/validation";

// Owners only; staff get FORBIDDEN. The check lives in src/modules/labels/service.ts.

/** Names are unique, compared case-insensitively. `color` is a key from src/lib/colors.ts. */
export async function createLabelAction(input: { name: string; color: string }): Promise<ActionResult<LabelDTO>> {
  return asActor((actor) => withInput(createLabelSchema, input, (data) => labels.createLabel(actor, data)));
}

export async function updateLabelAction(input: {
  id: string;
  name?: string;
  color?: string;
}): Promise<ActionResult<LabelDTO>> {
  return asActor((actor) => withInput(updateLabelSchema, input, (data) => labels.updateLabel(actor, data)));
}

/** Removes the label from every task that carries it. */
export async function deleteLabelAction(id: string): Promise<ActionResult<{ id: string }>> {
  return asActor((actor) => withInput(idSchema, id, (labelId) => labels.deleteLabel(actor, labelId)));
}
