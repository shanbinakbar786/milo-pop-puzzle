/* Milo Pop Puzzle — service worker (PWA offline support).
   Cache-first for the game's OWN same-origin files only. Bump CACHE on
   every game update so players always get the newest version. */
var CACHE = 'milo-pop-puzzle-v2';
var ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './game.js',
  './style.css',
  './i18n.js',
  './levels.js',
  './challenges.js',
  './backup.js',
  './audio/audio.js',
  './audio/click.mp3',
  './audio/combo.mp3',
  './audio/gameover.mp3',
  './audio/music.mp3',
  './audio/pop.mp3',
  './assets/logo-animated-v1.mp4',
  './assets/logo.png',
  './assets/milo.webp',
  './icon/milo-pop-icon-192.png',
  './icon/milo-pop-icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return; /* never cache external URLs */
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      if (cached) return cached;
      return fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () {
        /* offline + not cached: show the game shell for page loads only */
        if (e.request.mode === 'navigate') return caches.match('./index.html');
        return Promise.reject(new Error('offline'));
      });
    })
  );
});
