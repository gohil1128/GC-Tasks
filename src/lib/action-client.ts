import { toast } from "sonner";
import type { ActionResult } from "@/modules/tasks/types";

/*
  Every board write from the browser goes through here, so failure looks the
  same everywhere: an expected failure is toasted with the server's own words,
  a lost session goes back to sign-in, and a dropped connection says so
  instead of leaving a card stuck half-moved.

  CONFLICT is not toasted — the caller has the current task and knows better
  how to show it.
*/
export async function runAction<T>(
  pending: Promise<ActionResult<T>>,
  opts: { quiet?: boolean } = {},
): Promise<ActionResult<T>> {
  let result: ActionResult<T>;
  try {
    result = await pending;
  } catch {
    if (!opts.quiet) toast.error("Couldn't reach the server. Check your connection and try again.");
    return { ok: false, code: "INVALID", error: "Network error" };
  }
  if (!result.ok) {
    if (result.code === "UNAUTHORIZED") {
      window.location.href = "/login";
    } else if (result.code === "PASSWORD_CHANGE_REQUIRED") {
      window.location.href = "/change-password";
    } else if (result.code !== "CONFLICT" && !opts.quiet) {
      toast.error(result.error);
    }
  }
  return result;
}
