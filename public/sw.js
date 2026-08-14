const CACHE_NAME = 'homer-bird-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.webmanifest',
  '/assets/sounds/homero-gimiendo.mp3',
  '/assets/sounds/homero-gimiendo222_ZBxsWJA_final.mp3',
  '/assets/sprites/spritesheet.png',
  '/assets/sprites/homer-death.png',
  '/assets/bakgrounds/6PC0Z.jpg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('PWA: Some assets could not be pre-cached during install', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Ignorar peticiones que no sean GET o esquemas extraños (chrome-extension, etc)
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          // Cachear respuestas exitosas de assets estáticos y fuentes
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            (event.request.url.includes('/assets/') ||
              event.request.url.includes('/icons/') ||
              event.request.url.includes('fonts.gstatic.com') ||
              event.request.url.includes('fonts.googleapis.com'))
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Fallback para navegación offline a la página principal
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
    })
  );
});
