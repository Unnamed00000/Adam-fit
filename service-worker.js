const CACHE_NAME = "adam-fit-v104";
const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css?v=1.0.0",
  "./src/app.js?v=1.0.4",
  "./src/i18n.js?v=1.0.4",
  "./src/fitness.js?v=1.0.4",
  "./src/storage.js?v=1.0.4",
  "./src/firebase.js?v=1.0.4",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => (
      cached || fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => caches.match("./index.html"))
    ))
  );
});
