// ── FCM background messaging ──────────────────────────────────
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
  if (!firebase.apps.length) {
    firebase.initializeApp({
      apiKey:            'AIzaSyB0WIHyCtPyndl8SDHbM23cXCXXDgRb9UA',
      authDomain:        'kaisen-ec30a.firebaseapp.com',
      projectId:         'kaisen-ec30a',
      storageBucket:     'kaisen-ec30a.firebasestorage.app',
      messagingSenderId: '732869224381',
      appId:             '1:732869224381:web:425650f07bc7cfaacc14d4',
    });
  }
  const _msg = firebase.messaging();
  _msg.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || 'Kaisen';
    const body  = payload.notification?.body  || 'Hora de completar seus hábitos!';
    self.registration.showNotification(title, {
      body, icon: '/assets/icone.png', badge: '/assets/icone.png',
      tag: 'kaisen-reminder', renotify: true, data: { url: '/dashboard.html' },
    });
  });
} catch (_) { /* FCM indisponível neste ambiente */ }

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/dashboard.html'));
});

const STATIC_CACHE  = 'kaisen-static-v2';
const RUNTIME_CACHE = 'kaisen-runtime-v1';
const ALL_CACHES    = new Set([STATIC_CACHE, RUNTIME_CACHE]);

// Local assets precached on install
const STATIC_ASSETS = [
  '/login.html',
  '/dashboard.html',
  '/offline.html',
  '/css/style.css',
  '/js/app.js',
  '/js/firebase.js',
  '/js/charts.js',
  '/js/pwa.js',
  '/manifest.json',
  '/assets/icone.png',
  '/assets/logo-fundo-tranparente.png',
  '/assets/logo-fundo-escuro.png',
];

// ── Install ───────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate ──────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !ALL_CACHES.has(k)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Firebase Auth / Firestore / Google Identity: network-only, no caching
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs'))
  ) {
    event.respondWith(fetch(request));
    return;
  }

  // Google Fonts + Chart.js CDN: stale-while-revalidate
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'cdn.jsdelivr.net'
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Everything else (local assets): cache-first → offline fallback
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          }
          return res;
        })
        .catch(() => {
          if (request.mode === 'navigate') return caches.match('/offline.html');
        });
    })
  );
});

// ── Helpers ───────────────────────────────────────────────────
async function staleWhileRevalidate(request) {
  const cache  = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((res) => {
    if (res.ok) { const clone = res.clone(); cache.put(request, clone); }
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}
