/* sw.js — DIJANA oleh tools/build-sw.mjs. Jangan sunting terus; sunting tools/sw.template.js.
 * Strategi: SEMUA aset aplikasi dicache semasa pemasangan → aplikasi berfungsi sepenuhnya LUAR TALIAN
 * selepas lawatan pertama (penting untuk dewan majlis tanpa WiFi stabil). Data (IndexedDB) tidak disentuh. */
var CACHE = 'ldr-6ee10a8ebbee';
var ASSETS = [
  "./",
  "index.html",
  "checkin.html",
  "manifest.webmanifest",
  "css/app.css",
  "js/attendance.js",
  "js/audio.js",
  "js/auth.js",
  "js/checkin.js",
  "js/cloud.js",
  "js/db.js",
  "js/fx.js",
  "js/icons.js",
  "js/io.js",
  "js/logic.js",
  "js/main.js",
  "js/race.js",
  "js/race2d.js",
  "js/race3d.js",
  "js/rng.js",
  "js/store.js",
  "js/util.js",
  "js/views/attendance.js",
  "js/views/audit.js",
  "js/views/dashboard.js",
  "js/views/draw.js",
  "js/views/history.js",
  "js/views/import.js",
  "js/views/participants.js",
  "js/views/prizes.js",
  "js/views/reports.js",
  "js/views/settings.js",
  "vendor/qrcode.js",
  "vendor/three.module.min.js",
  "vendor/xlsx.full.min.js",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon.svg",
  "icons/logo.svg",
  "icons/mascot.svg",
  "icons/maskable-512.png"
];

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
