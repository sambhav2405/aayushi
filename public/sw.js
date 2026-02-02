const CACHE_NAME = 'ers-cafe-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css', // Agar alag file h to
  '/logo.png',
  '/admin.html'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Fetch Event (Offline Support)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
