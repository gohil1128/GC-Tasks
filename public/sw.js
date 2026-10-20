/*
  GC Tasks service worker — Web Push only.

  It deliberately does NO offline caching: the board is live data behind a
  login, and a cached page would be a stale (or wrong person's) board. The
  fetch listener exists only because a service worker with one is what
  makes the site installable; it lets every request go straight to the
  network.
*/

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Network passthrough — never respond from here.
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = data.title || "GC Tasks";
  const options = {
    body: data.body || "Something changed on the board.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // One notification per task: a second change to the same card
    // replaces the first instead of stacking.
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const win of windows) {
        if (new URL(win.url).origin === self.location.origin && "focus" in win) {
          win.focus();
          if ("navigate" in win) win.navigate(target);
          return;
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
