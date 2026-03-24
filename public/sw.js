const CACHE_NAME = "liquid-notes-v1";
const OFFLINE_URLS = ["/", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(event.request)
        .then((response) => {
          const cloned = response.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, cloned);
          });

          return response;
        })
        .catch(() => caches.match("/"));
    }),
  );
});

self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : {};
  const title = payload.title || "Напоминание";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "Пора вернуться к заметке.",
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: {
        href: payload.href || "/",
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = event.notification.data?.href || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => "focus" in client);

      if (existing) {
        existing.navigate(href);
        return existing.focus();
      }

      return self.clients.openWindow(href);
    }),
  );
});
