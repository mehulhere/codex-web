const SHELL_CACHE_PREFIX = "codex-mobile-shell-";
const SHELL_CACHE = `${SHELL_CACHE_PREFIX}v6`;
const SHELL_FILES = ["/offline.html", "/manifest.webmanifest", "/icons/codex-mobile.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then(async (keys) => {
        const previousShellExists = keys.some(
          (key) => key.startsWith(SHELL_CACHE_PREFIX) && key !== SHELL_CACHE
        );
        await Promise.all(
          keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))
        );
        await self.clients.claim();
        if (!previousShellExists) {
          return;
        }
        const windows = await self.clients.matchAll({
          includeUncontrolled: true,
          type: "window"
        });
        await Promise.allSettled(
          windows.map((client) => client.navigate(client.url))
        );
      })
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith("/api/") || requestUrl.pathname === "/events") {
    return;
  }
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html")));
    return;
  }
  if (SHELL_FILES.includes(requestUrl.pathname)) {
    event.respondWith(caches.match(event.request).then((response) => response ?? fetch(event.request)));
  }
});
