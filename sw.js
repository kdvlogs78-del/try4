/* Agency Ledger service worker
 * - Precaches the app shell and the CDN libraries on install.
 * - Dynamically caches anything else fetched (Tailwind, FontAwesome CSS + webfonts,
 *   jsPDF, autotable, Google Fonts) using stale-while-revalidate.
 * Bump CACHE_VERSION whenever you ship new app files.
 */
const CACHE_VERSION = 'v2';
const CACHE_NAME = `agency-ledger-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png'
];

const CDN_ASSETS = [
  'https://cdn.tailwindcss.com/3.4.17',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
];

const isCacheable = (res) => res && (res.ok || res.type === 'opaque');

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);
      // CDN files are cross-origin: fetch in no-cors mode and tolerate individual failures.
      await Promise.allSettled(
        CDN_ASSETS.map(async (url) => {
          const res = await fetch(new Request(url, { mode: 'no-cors' }));
          if (isCacheable(res)) await cache.put(url, res);
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('agency-ledger-') && k !== CACHE_NAME).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;

  // Page navigations: network first, fall back to cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
          return fresh;
        } catch (err) {
          return (await caches.match(req)) || (await caches.match('./index.html')) || (await caches.match('./'));
        }
      })()
    );
    return;
  }

  // Everything else (local files + CDN libs, fonts, icon webfonts): stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (isCacheable(res)) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      return cached || (await network) || Response.error();
    })()
  );
});
