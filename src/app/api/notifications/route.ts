import { json, withUser } from "@/modules/notifications/http";
import { getNotificationFeed } from "@/modules/notifications/queries";

// The bell: the newest board activity by other people, this person's
// unread count, and the push public key when push is configured.
export const dynamic = "force-dynamic";

export async function GET() {
  return withUser(async (me) => json(await getNotificationFeed(me.id), 200));
}
