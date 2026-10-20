import { z } from "zod";
import { json, withUser } from "@/modules/notifications/http";
import {
  removePushSubscription,
  savePushSubscription,
} from "@/modules/notifications/queries";

/*
  A browser's Web Push subscription for the signed-in person. Subscribing
  is per device: the phone and the laptop each send theirs, and turning
  notifications off on a device removes only that device's row.
*/

export const dynamic = "force-dynamic";

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
});

const endpointSchema = z.object({ endpoint: z.string().url().max(2048) });

export async function POST(request: Request) {
  return withUser(async (me) => {
    const parsed = subscribeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: "INVALID" }, 400);
    await savePushSubscription(me.id, {
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent: request.headers.get("user-agent")?.slice(0, 256) ?? null,
    });
    return json({ ok: true }, 200);
  });
}

export async function DELETE(request: Request) {
  return withUser(async (me) => {
    const parsed = endpointSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: "INVALID" }, 400);
    await removePushSubscription(me.id, parsed.data.endpoint);
    return json({ ok: true }, 200);
  });
}
