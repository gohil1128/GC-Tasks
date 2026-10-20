import { json, withUser } from "@/modules/notifications/http";
import { markNotificationsRead } from "@/modules/notifications/queries";

// The bell was opened — everything so far counts as read for this person.
export const dynamic = "force-dynamic";

export async function POST() {
  return withUser(async (me) => {
    await markNotificationsRead(me.id);
    return json({ ok: true }, 200);
  });
}
