"use server";
// CONTRACT STUB — signatures are fixed; bodies are implemented by the server-core builder.
import type { ActionResult, LabelDTO } from "@/modules/tasks/types";

const TODO = (): never => {
  throw new Error("not implemented");
};

/** Names are unique, compared case-insensitively. `color` is a key from src/lib/colors.ts. */
export async function createLabelAction(input: { name: string; color: string }): Promise<ActionResult<LabelDTO>> {
  void input;
  return TODO();
}

export async function updateLabelAction(input: {
  id: string;
  name?: string;
  color?: string;
}): Promise<ActionResult<LabelDTO>> {
  void input;
  return TODO();
}

/** Removes the label from every task that carries it. */
export async function deleteLabelAction(id: string): Promise<ActionResult<{ id: string }>> {
  void id;
  return TODO();
}
