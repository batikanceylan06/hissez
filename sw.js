const CACHE_NAME = "hissez-public-v22-security";
const ASSETS = [
  "/",
  "/index.html",
  "/siirler.html",
  "/gun-notlari.html",
  "/yazi.html",
  "/hakkimda.html",
  "/assets/css/style.css",
  "/assets/js/main.js",
  "/assets/js/posts.js",
  "/assets/js/firebase-config.js",
  "/assets/img/hissez-logo.png",
  "/assets/img/hissez-bg.jpeg",
  "/assets/audio/hissez-sessiz-ambiyans.ogg",
  "/assets/audio/hissez-gece-defteri.ogg",
  "/assets/audio/hissez-siir-odasi.ogg",
  "/assets/audio/hissez-gun-notu.ogg",
  "/assets/icons/favicon.ico",
  "/assets/icons/favicon-16x16.png",
  "/assets/icons/favicon-32x32.png",
  "/assets/icons/apple-touch-icon.png",
  "/assets/icons/android-chrome-192x192.png",
  "/assets/icons/android-chrome-512x512.png",
  "/site.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys
      .filter((key) => (key.startsWith("hissez-public-") || key.startsWith("hissez-panel-")) && key !== CACHE_NAME)
      .map((key) => caches.delete(key))
  )));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const networkOnlyPaths = new Set([
    "/sezin-panel.html",
    "/assets/js/admin.js",
    "/assets/css/admin.css",
    "/panel.webmanifest"
  ]);
  if (networkOnlyPaths.has(url.pathname)) return;

  event.respondWith(
    fetch(event.request)
      .then(async (networkResponse) => {
        if (networkResponse.ok && networkResponse.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) return cachedResponse;
        if (event.request.mode === "navigate") {
          return (await caches.match("/index.html")) || Response.error();
        }
        return Response.error();
      })
  );
});
