const CACHE_NAME = "hissez-public-v21-bg-visible";
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
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return networkResponse;
      })
      .catch(() => caches.match(event.request).then((response) => response || caches.match("/index.html")))
  );
});