"use server";
import { requireUser, type CurrentUser } from "@/lib/auth";
import type { Role } from "@/lib/permissions";
import type { ActionResult, Member } from "@/modules/tasks/types";
import {
  addMember,
  resetMemberPassword,
  sessionFailure,
  setMemberActive,
  setMemberRole,
  updateProfile,
} from "@/modules/team/service";

/*
  Everything here except updateProfileAction is owners-only (FORBIDDEN for
  staff), checked on the server — in ./service.ts, against the database as it
  stands inside the transaction, not against what the browser was showing.
*/

/** Authenticate, then hand over; a lost or half-finished session comes back as a result, not a throw. */
async function asSignedIn<T>(work: (actor: CurrentUser) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  let actor: CurrentUser;
  try {
    actor = await requireUser();
  } catch (err) {
    return sessionFailure(err);
  }
  return work(actor);
}

/**
  Add an owner or a staff member. Returns the one-time temporary password to
  hand over; the new account must change it at first sign-in.
*/
export async function addMemberAction(input: {
  name: string;
  email: string;
  role: Role;
}): Promise<ActionResult<{ member: Member; tempPassword: string }>> {
  return asSignedIn((actor) => addMember(actor, input));
}

/** Sets a fresh temporary password (and mustChangePassword). Not for yourself. */
export async function resetMemberPasswordAction(id: string): Promise<ActionResult<{ tempPassword: string }>> {
  return asSignedIn((actor) => resetMemberPassword(actor, id));
}

/**
  Deactivate / reactivate. You cannot deactivate yourself, and the last active
  OWNER cannot be deactivated. Deactivating removes them from every task's
  assignees on the board.
*/
export async function setMemberActiveAction(id: string, active: boolean): Promise<ActionResult<Member>> {
  return asSignedIn((actor) => setMemberActive(actor, id, active));
}

/**
  Promote to owner or change to staff. Not for yourself, and never leaving the
  board without an active owner. Demoting does not touch assignments — staff
  can still be on tasks.
*/
export async function setMemberRoleAction(id: string, role: Role): Promise<ActionResult<Member>> {
  return asSignedIn((actor) => setMemberRole(actor, id, role));
}

/** Your own name and avatar colour. Anyone, owner or staff. */
export async function updateProfileAction(input: { name: string; color: string; avatar?: string }): Promise<ActionResult<Member>> {
  return asSignedIn((actor) => updateProfile(actor, input));
}
