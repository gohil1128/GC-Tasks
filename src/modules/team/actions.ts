"use server";
// CONTRACT STUB — signatures are fixed; bodies are implemented by the team/auth builder.
import type { Role } from "@/lib/permissions";
import type { ActionResult, Member } from "@/modules/tasks/types";

const TODO = (): never => {
  throw new Error("not implemented");
};

/*
  Everything here except updateProfileAction is owners-only (FORBIDDEN for
  staff), checked on the server.
*/

/**
  Add an owner or a staff member. Returns the one-time temporary password to
  hand over; the new account must change it at first sign-in.
*/
export async function addMemberAction(input: {
  name: string;
  email: string;
  role: Role;
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
  OWNER cannot be deactivated. Deactivating removes them from every task's
  assignees on the board.
*/
export async function setMemberActiveAction(id: string, active: boolean): Promise<ActionResult<Member>> {
  void id;
  void active;
  return TODO();
}

/**
  Promote to owner or change to staff. Not for yourself, and never leaving the
  board without an active owner. Demoting does not touch assignments — staff
  can still be on tasks.
*/
export async function setMemberRoleAction(id: string, role: Role): Promise<ActionResult<Member>> {
  void id;
  void role;
  return TODO();
}

/** Your own name and avatar colour. Anyone, owner or staff. */
export async function updateProfileAction(input: { name: string; color: string }): Promise<ActionResult<Member>> {
  void input;
  return TODO();
}
