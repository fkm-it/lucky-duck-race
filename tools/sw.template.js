/* sw.js — DIJANA oleh tools/build-sw.mjs. Jangan sunting terus; sunting tools/sw.template.js.
 * Strategi: SEMUA aset aplikasi dicache semasa pemasangan → aplikasi berfungsi sepenuhnya LUAR TALIAN
 * selepas lawatan pertama (penting untuk dewan majlis tanpa WiFi stabil). Data (IndexedDB) tidak disentuh. */
var CACHE = 'ldr-__VERSION__';
var ASSETS = __ASSETS__;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('ldr-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Rangkaian dahulu (versi terkini); luar talian → index dari cache
    e.respondWith(fetch(req).catch(function () { return caches.match('./', { ignoreSearch: true }); }));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    });
  }));
});
