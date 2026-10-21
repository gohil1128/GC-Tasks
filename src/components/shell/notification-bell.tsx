"use client";
import * as React from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { timeAgo } from "@/lib/dates";
import { cn } from "@/lib/utils";

/*
  The board's bell: what the rest of the team has been doing, and the
  switch for phone (Web Push) notifications.

  The feed comes from /api/notifications — the board's Activity rows read
  across all tasks, minus your own changes. Opening the bell marks them
  read on the server (a watermark on your account), so the badge is the
  same on every device. The feed is re-read every 30 seconds and whenever
  the tab comes back to the front; pushes cover the times the app is
  closed entirely.

  Push is per device and opt-in here: subscribing needs a click (browsers
  insist), a service worker (/sw.js, registered on mount) and, on iPhone,
  the app opened from its Home Screen icon — in a plain Safari tab there
  is no PushManager at all, which is the "not available" case below.
*/

type FeedItem = {
  id: string;
  actorId: string;
  actorName: string;
  actorColor: string;
  actorAvatar: string | null;
  text: string;
  taskId: string;
  taskTitle: string;
  taskArchived: boolean;
  createdAt: string;
  unread: boolean;
};

type Feed = { items: FeedItem[]; unread: number; pushPublicKey: string | null };

type PushState = "checking" | "unavailable" | "off" | "on" | "denied" | "busy";

const POLL_MS = 30_000;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function NotificationBell() {
  const [feed, setFeed] = React.useState<Feed | null>(null);
  const [open, setOpen] = React.useState(false);
  const [push, setPush] = React.useState<PushState>("checking");
  const registration = React.useRef<ServiceWorkerRegistration | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (res.ok) setFeed((await res.json()) as Feed);
    } catch {
      // A failed poll just leaves the last good feed on screen.
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // Register the push service worker and find out where this device stands.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setPush("unavailable");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        registration.current = reg;
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (Notification.permission === "denied") setPush("denied");
        else setPush(sub ? "on" : "off");
      } catch {
        if (!cancelled) setPush("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && feed && feed.unread > 0) {
      setFeed({ ...feed, unread: 0 });
      void fetch("/api/notifications/read", { method: "POST" }).catch(() => {});
    }
  };

  const enablePush = async () => {
    const publicKey = feed?.pushPublicKey;
    if (!publicKey || push === "busy") return;
    setPush("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPush(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = registration.current ?? (await navigator.serviceWorker.register("/sw.js"));
      registration.current = reg;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        }));
      const res = await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setPush(res.ok ? "on" : "off");
    } catch {
      setPush("off");
    }
  };

  const disablePush = async () => {
    if (push === "busy") return;
    setPush("busy");
    try {
      const reg = registration.current;
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setPush("off");
    } catch {
      setPush("on");
    }
  };

  const unread = feed?.unread ?? 0;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          className={cn(
            "relative flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          <Bell className="h-5 w-5" aria-hidden />
          {unread > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(var(--rust-500))] px-1 text-[10px] font-bold leading-none text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <p className="border-b border-border px-3.5 py-2.5 text-sm font-semibold">Notifications</p>

        <div className="max-h-[55vh] overflow-y-auto py-1.5">
          {!feed ? (
            <p className="px-3.5 py-3 text-sm text-muted-foreground">Loading…</p>
          ) : feed.items.length === 0 ? (
            <p className="px-3.5 py-3 text-sm text-muted-foreground">
              Nothing yet — changes your team makes will show up here.
            </p>
          ) : (
            <ol>
              {feed.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = item.taskArchived ? "/" : `/?task=${item.taskId}`;
                    }}
                    className="flex w-full items-start gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <span aria-hidden className="pt-0.5">
                      <Avatar
                        person={{ id: item.actorId, name: item.actorName, color: item.actorColor, avatar: item.actorAvatar }}
                        size="xs"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-snug [overflow-wrap:anywhere]">
                        <span className="font-medium">{item.actorName}</span> {item.text}
                        {item.unread && (
                          <span
                            aria-label="Unread"
                            className="ml-1.5 inline-block h-2 w-2 rounded-full bg-[hsl(var(--rust-500))] align-middle"
                          />
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {item.taskTitle} · {timeAgo(item.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="border-t border-border px-3.5 py-2.5">
          {feed && !feed.pushPublicKey ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Phone notifications aren&apos;t set up on this deployment yet.
            </p>
          ) : push === "unavailable" ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Phone notifications aren&apos;t available in this browser. On iPhone, add GC Tasks to
              your Home Screen and open it from there, then turn them on here.
            </p>
          ) : push === "denied" ? (
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <BellOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Notifications are blocked for this site in your browser settings.
            </p>
          ) : push === "on" ? (
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <BellRing className="h-4 w-4 shrink-0" aria-hidden />
                Phone notifications are on for this device.
              </p>
              <button
                type="button"
                onClick={() => void disablePush()}
                className="shrink-0 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Turn off
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={push === "checking" || push === "busy" || !feed}
              onClick={() => void enablePush()}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-espresso px-3 py-2 text-sm font-medium text-espresso-foreground transition-opacity disabled:opacity-50"
            >
              <BellRing className="h-4 w-4" aria-hidden />
              {push === "busy" ? "Turning on…" : "Get phone notifications"}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
