/**
 * KOLIYA — sw_sm.js
 * ============================================================
 * Service worker.
 *
 * The rule that matters most here:
 *   API responses are NEVER cached.
 *
 * A social app serves private messages over the same origin as its
 * CSS. Caching those would leave one student's DMs on a shared or
 * borrowed laptop, readable offline, after logout. So the fetch
 * handler refuses anything that looks like data or auth, and only
 * caches the shell and public media.
 *
 * Strategies:
 *   app shell (html/css/js)  → stale-while-revalidate
 *   R2 media (immutable)     → cache-first, capped
 *   fonts                    → cache-first, long lived
 *   /rest/ /auth/ tokens     → network only, never stored
 * ============================================================
 */

const VERSION    = 'v1';
const SHELL      = `koliya-shell-${VERSION}`;
const MEDIA      = `koliya-media-${VERSION}`;
const FONTS      = `koliya-fonts-${VERSION}`;
const CACHES     = [SHELL, MEDIA, FONTS];

const MEDIA_MAX  = 120;   // entries, roughly 60–100 MB of images
const OFFLINE_URL = '/offline_sm.html';

/** Files needed to render the frame with no network at all. */
const PRECACHE = [
  '/',
  '/index_sm.html',
  '/offline_sm.html',
  '/manifest_sm.json',
  '/css/base_sm.css',
  '/css/components_sm.css',
  '/css/layout_sm.css',
  '/js/app_sm.js',
  '/js/core/utils_sm.js',
  '/js/core/store_sm.js',
  '/js/core/router_sm.js',
  '/js/core/ui_sm.js',
  '/js/core/shell_sm.js',
  '/js/core/icons_sm.js'
];

/* ------------------------------------------------------------
   INSTALL
   ------------------------------------------------------------ */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // addAll fails the whole install if one file 404s; add
    // individually so a missing optional file cannot brick the SW.
    await Promise.all(PRECACHE.map(async url => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { console.warn('[sw] precache ignoré:', url); }
    }));
    self.skipWaiting();
  })());
});

/* ------------------------------------------------------------
   ACTIVATE  — drop old versions
   ------------------------------------------------------------ */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => n.startsWith('koliya-') && !CACHES.includes(n))
           .map(n => caches.delete(n))
    );
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});

/* ------------------------------------------------------------
   ROUTING HELPERS
   ------------------------------------------------------------ */

/** Anything that could contain personal data. Never cached. */
function isPrivate(url) {
  return /\/(rest|auth|api)\//.test(url.pathname)
      || /(apirest|neon\.tech|stack-auth|workers\.dev)/.test(url.hostname)
      || url.pathname.endsWith('/sign');
}

function isMedia(url) {
  return /\.(png|jpe?g|webp|gif|avif|mp4|webm|m4a|mp3|ogg)$/i.test(url.pathname)
      || /r2\.dev|r2\.cloudflarestorage\.com/.test(url.hostname);
}

function isFont(url) {
  return /fonts\.(googleapis|gstatic)\.com/.test(url.hostname)
      || /\.(woff2?|ttf)$/i.test(url.pathname);
}

function isShellAsset(url) {
  return url.origin === self.location.origin
      && /\.(css|js|json|svg)$/i.test(url.pathname);
}

/** Keep a cache from growing without bound. */
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  // oldest first — Cache API preserves insertion order
  await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
}

/* ------------------------------------------------------------
   STRATEGIES
   ------------------------------------------------------------ */

/** Serve cache instantly, refresh in the background. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request).then(response => {
    if (response && response.ok && response.type !== 'opaque') {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || network || fetch(request);
}

/** Media at an R2 URL never changes — cache it and keep it. */
async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    await cache.put(request, response.clone());
    if (max) trim(cacheName, max);
  }
  return response;
}

/* ------------------------------------------------------------
   FETCH
   ------------------------------------------------------------ */
self.addEventListener('fetch', event => {
  const { request } = event;

  // Only GET is ever cacheable.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Private data: straight to the network, nothing stored.
  if (isPrivate(url)) return;

  // Chrome extensions and other schemes
  if (!url.protocol.startsWith('http')) return;

  // Navigations: try network first so a deployed update is picked up,
  // fall back to the cached shell, then to the offline page.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;
        return await fetch(request);
      } catch {
        const cache = await caches.open(SHELL);
        return (await cache.match('/index_sm.html'))
            || (await cache.match(OFFLINE_URL))
            || new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  if (isMedia(url)) { event.respondWith(cacheFirst(request, MEDIA, MEDIA_MAX)); return; }
  if (isFont(url))  { event.respondWith(cacheFirst(request, FONTS)); return; }
  if (isShellAsset(url)) { event.respondWith(staleWhileRevalidate(request, SHELL)); return; }
});

/* ------------------------------------------------------------
   MESSAGES FROM THE PAGE
   ------------------------------------------------------------ */
self.addEventListener('message', event => {
  const { type } = event.data || {};

  if (type === 'SKIP_WAITING') self.skipWaiting();

  // Called on logout: wipe everything that could hold user content.
  if (type === 'PURGE') {
    event.waitUntil((async () => {
      await caches.delete(MEDIA);
      event.source?.postMessage({ type: 'PURGED' });
    })());
  }

  if (type === 'VERSION') {
    event.source?.postMessage({ type: 'VERSION', version: VERSION });
  }
});

/* ------------------------------------------------------------
   PUSH  (wired later, when a push provider is configured)
   ------------------------------------------------------------ */
self.addEventListener('push', event => {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch { payload = { body: event.data.text() }; }

  const title = payload.title || 'Koliya';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: payload.tag || 'koliya',
    renotify: false,
    data: { url: payload.url || '/index_sm.html' },
    // group repeated notifications instead of stacking them
    silent: false
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/index_sm.html';

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // focus an existing tab rather than opening a second one
    for (const client of clientList) {
      if (client.url.includes(self.location.origin) && 'focus' in client) {
        await client.focus();
        client.postMessage({ type: 'NAVIGATE', url: target });
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
