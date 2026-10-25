// Uygulama kabuğunu önbelleğe alır; internet yokken de açılır.
const CACHE = "bleep-v9";
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  // İkon adresleri index.html ve manifest'teki ?v= sürümüyle birebir aynı olmalı; yoksa çevrimdışıyken önbellekten bulunamaz.
  "./favicon.svg?v=6", "./favicon.ico?v=6", "./apple-touch-icon.png?v=6",
  "./icon-192.png?v=6", "./icon-512.png?v=6", "./icon-maskable-512.png?v=6",
  // Gömülü harita kütüphanesi (Leaflet): çevrimdışıyken de harita arayüzü yüklensin.
  // ?v=7 index.html'deki <link>/<script> adresiyle birebir aynı olmalı.
  "./vendor/leaflet/leaflet.css?v=7", "./vendor/leaflet/leaflet.js?v=7",
  "./vendor/leaflet/images/marker-icon.png", "./vendor/leaflet/images/marker-icon-2x.png",
  "./vendor/leaflet/images/marker-shadow.png",
  "./vendor/leaflet/images/layers.png", "./vendor/leaflet/images/layers-2x.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Önce ağ (güncel sürüm), ağ yoksa önbellek.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")))
  );
});
