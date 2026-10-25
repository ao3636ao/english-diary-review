/* Only the public app shell is cached. Diary data stays in IndexedDB. */
const CACHE = "english-diary-review-shell-playback-v3";
const FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./src/app.js",
  "./src/core.js",
  "./src/db.js",
  "./src/views.js",
  "./manifest.webmanifest",
  "./assets/playback-wordmark.png",
  "./assets/hero-grassland.webp",
  "./assets/playback-icon-96.png",
  "./assets/playback-icon-192.png",
  "./assets/playback-icon-512.png",
  "./assets/playback-icon-maskable-512.png",
];
const shell = new Set(
  FILES.map((path) => new URL(path, self.registration.scope).href),
);
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...shell])));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith("english-diary-review-shell-") && name !== CACHE,
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !shell.has(event.request.url)) return;
  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      return cached ?? fetch(event.request);
    })(),
  );
});
