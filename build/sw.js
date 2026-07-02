// ReefDeck Service Worker — v1.9.0
// Caches app shell for offline use. User data lives in localStorage/IndexedDB on device only.

const CACHE_NAME = 'reefdeck-v8';
const SHELL_URLS = [
  '/app/',
  '/app/index.html',
  '/app/app.css',
  '/app/app.js',
  '/app/icons.js',
  '/app/charts.js',
  '/app/forecast.js',
  '/app/coral.js',
  '/app/drive.js',
  '/app/push.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_URLS).catch((err) => {
        // Non-fatal: app still works online if cache fails during dev
        console.warn('SW cache pre-load partial failure:', err);
      });
    })
  );
  // NOTE: no skipWaiting() here on purpose — a new version installs quietly and
  // WAITS. The app shows a "new version ready → Refresh" prompt; tapping it
  // posts SKIP_WAITING below, so we never reload mid-edit without consent.
});

// Apply the update only when the app asks (user tapped Refresh).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ---- Web Push: show a maintenance reminder even when the app is closed ----
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || 'ReefDeck';
  const options = {
    body: data.body || 'You have maintenance due.',
    tag: data.tag || 'reefdeck-due',
    data: { url: data.url || '/app/' },
    badge: '/assets/icons/favicon-32.png',
    icon: '/assets/icons/icon-192.png',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/app/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.indexOf('/app') !== -1 && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests for our own origin
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
