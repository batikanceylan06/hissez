const CACHE_NAME = "hissez-public-v34-clean-routes";
const NETWORK_TIMEOUT_MS = 4500;
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/siirler",
  "/siirler.html",
  "/gun-notlari",
  "/gun-notlari.html",
  "/arsiv",
  "/arsiv.html",
  "/yazi.html",
  "/hakkimda",
  "/hakkimda.html",
  "/assets/css/style.css",
  "/assets/js/main.js?v=34",
  "/assets/js/posts.js?v=34",
  "/assets/js/post-utils.js",
  "/assets/js/firebase-config.js",
  "/assets/img/hissez-logo.png",
  "/assets/img/hissez-bg.jpeg",
  "/assets/icons/favicon.ico",
  "/assets/icons/favicon-16x16.png",
  "/assets/icons/favicon-32x32.png",
  "/assets/icons/apple-touch-icon.png",
  "/assets/icons/android-chrome-192x192.png",
  "/assets/icons/android-chrome-512x512.png",
  "/site.webmanifest"
];
const OPTIONAL_ASSETS = [
  "/assets/audio/hissez-sessiz-ambiyans.ogg",
  "/assets/audio/hissez-gece-defteri.ogg",
  "/assets/audio/hissez-siir-odasi.ogg",
  "/assets/audio/hissez-gun-notu.ogg"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    await Promise.allSettled(OPTIONAL_ASSETS.map((asset) => cache.add(asset)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith("hissez-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const networkOnlyPaths = new Set([
    "/sezin-panel",
    "/sezin-panel.html",
    "/assets/js/admin.js",
    "/assets/css/admin.css",
    "/panel.webmanifest"
  ]);
  if (networkOnlyPaths.has(url.pathname)) return;

  event.respondWith((async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    try {
      const networkResponse = await fetch(event.request, { signal: controller.signal });
      clearTimeout(timeout);
      if (networkResponse.ok && networkResponse.type === "basic") {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, networkResponse.clone());
      }
      return networkResponse;
    } catch {
      clearTimeout(timeout);
      const cachedResponse = await caches.match(event.request, { ignoreSearch: event.request.mode === "navigate" });
      if (cachedResponse) return cachedResponse;
      if (event.request.mode === "navigate") {
        if (/^\/(?:siir|gun-notu)\//.test(url.pathname)) {
          return (await caches.match("/yazi.html")) || Response.error();
        }
        return (await caches.match(url.pathname)) || (await caches.match("/index.html")) || Response.error();
      }
      return Response.error();
    }
  })());
});
