const CACHE = "hansei-link-v12";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./config.js",
  "./data.js",
  "./api.js",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/logo.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
  if (new URL(event.request.url).pathname.endsWith("/data/neis.json")) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match("./index.html")))
  );
});
