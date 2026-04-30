const CACHE_NAME = "hissez-panel-v18-structured";
const ASSETS = [
  "/sezin-panel.html",
  "/assets/css/admin.css",
  "/assets/js/admin.js",
  "/assets/js/firebase-config.js",
  "/assets/img/hissez-logo.png",
  "/assets/icons/favicon.ico",
  "/assets/icons/favicon-16x16.png",
  "/assets/icons/favicon-32x32.png",
  "/assets/icons/apple-touch-icon.png",
  "/assets/icons/android-chrome-192x192.png",
  "/assets/icons/android-chrome-512x512.png",
  "/panel.webmanifest"
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
  event.respondWith(caches.match(event.request).then((response) => response || fetch(event.request).then((networkResponse) => {
    const clone = networkResponse.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
    return networkResponse;
  }).catch(() => caches.match('/sezin-panel.html'))));
});