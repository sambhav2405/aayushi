// sw.js
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open('ers-cafe-store').then((cache) => cache.addAll([
      '/admin.html',
      '/style.css',
    ])),
  );
});

self.addEventListener('fetch', (e) => {
  console.log(e.request.url);
  e.respondWith(
    caches.match(e.request).then((response) => response || fetch(e.request)),
  );
});
