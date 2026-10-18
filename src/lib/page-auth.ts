import { redirect } from "next/navigation";
import { currentUser, type CurrentUser } from "@/lib/auth";

/*
  The signed-in person for a page under (app), or a redirect: to sign in, or
  to choose a password for someone still on one an owner set.

  The (app) layout makes the same check, but a layout and its page render in
  parallel — the layout's redirect does not stop the page from running, and
  what the page reads is still serialized into the response (an RSC request
  gets it with a 200). So every page calls this itself, before it reads
  anything.
*/
export async function requirePageUser(): Promise<CurrentUser> {
  const me = await currentUser();
  if (!me) redirect("/login");
  if (me.mustChangePassword) redirect("/change-password");
  return me;
}
