"use server";
// CONTRACT STUB — signatures are fixed; bodies are implemented by the team/auth builder.
import type { ActionResult, Member } from "@/modules/tasks/types";

const TODO = (): never => {
  throw new Error("not implemented");
};

/**
  Any owner may add another. Returns the one-time temporary password to hand
  over; the new account must change it at first sign-in.
*/
export async function addMemberAction(input: {
  name: string;
  email: string;
}): Promise<ActionResult<{ member: Member; tempPassword: string }>> {
  void input;
  return TODO();
}

/** Sets a fresh temporary password (and mustChangePassword). Not for yourself. */
export async function resetMemberPasswordAction(id: string): Promise<ActionResult<{ tempPassword: string }>> {
  void id;
  return TODO();
}

/**
  Deactivate / reactivate. You cannot deactivate yourself, and the last active
  account cannot be deactivated. Deactivating removes them from every task's
  assignees on the board.
*/
export async function setMemberActiveAction(id: string, active: boolean): Promise<ActionResult<Member>> {
  void id;
  void active;
  return TODO();
}

/** Your own name and avatar colour. */
export async function updateProfileAction(input: { name: string; color: string }): Promise<ActionResult<Member>> {
  void input;
  return TODO();
}
