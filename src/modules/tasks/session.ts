import type { z } from "zod";
import { requireUser } from "@/lib/auth";
import type { Actor } from "@/lib/permissions";
import type { ActionResult, ErrorCode } from "@/modules/tasks/types";
import { parseInput } from "@/modules/tasks/validation";

/*
  The two steps every board Server Action takes before the service: who is
  asking, then is the input well-formed — in that order, so an anonymous
  caller learns nothing about what a valid request looks like.

  requireUser() throws for a missing session or a password still to change;
  those are expected, so they come back as values the browser's runAction()
  knows how to handle (sign-in, change-password). Anything else it throws is
  a real fault and is left to surface.
*/

const SESSION_FAILURES: Partial<Record<ErrorCode, string>> = {
  UNAUTHORIZED: "You've been signed out. Sign in again to carry on.",
  PASSWORD_CHANGE_REQUIRED: "Choose a new password before carrying on.",
  FORBIDDEN: "You don't have access to do that.",
};

export async function asActor<T>(run: (actor: Actor) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  let actor: Actor;
  try {
    const user = await requireUser();
    actor = { id: user.id, role: user.role };
  } catch (err) {
    const code = (err instanceof Error ? err.message : "") as ErrorCode;
    const error = SESSION_FAILURES[code];
    if (error) return { ok: false, code, error };
    throw err;
  }
  return run(actor);
}

export async function withInput<S extends z.ZodTypeAny, T>(
  schema: S,
  raw: unknown,
  run: (data: z.output<S>) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const parsed = parseInput(schema, raw);
  if (!parsed.ok) return parsed;
  return run(parsed.data);
}
