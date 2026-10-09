/* Service worker. Generated into public/sw.js by build.mjs (do not edit the public copy). */
const CACHE = 'reinvent-v__BUILD__';
// Filled in by build.mjs: passphrase builds cache agenda.enc, unlock.js and render.js instead of agenda.json.
const PRECACHE = __PRECACHE__;
const REQUIRED = new Set(__REQUIRED__);
const NET_TIMEOUT_MS = 3000;

// Everything is resolved against the service worker scope (the folder sw.js is served from), so the site
// works at a domain root and under a subpath such as https://user.github.io/project/.
const SCOPE = new URL('./', self.registration.scope).href;
const abs = path => new URL(path, SCOPE).href;
const REQUIRED_ABS = new Set([...REQUIRED].map(abs));
const SW_URL = abs('sw.js'), DATA_URLS = new Set([abs('agenda.json'), abs('agenda.enc')]);

// A response is safe to store only if it is a normal same-origin 200 that did not pass through a redirect
// (a login redirect from Vercel Authentication must never replace the real page).
function isGood(res) {
  if (!res || !res.ok || res.redirected || res.type !== 'basic') return false;
  try { return new URL(res.url).origin === self.location.origin; } catch (e) { return false; }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(abs).map(async url => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (isGood(res)) await cache.put(url, res);
        else if (REQUIRED_ABS.has(url)) throw new Error('Bad response for ' + url);
      } catch (e) {
        if (REQUIRED_ABS.has(url)) throw e;
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('reinvent-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function cacheKey(request) {
  const url = new URL(request.url);
  if (request.mode === 'navigate' && (url.origin + url.pathname === SCOPE || url.origin + url.pathname === abs('index.html'))) return SCOPE;
  return request;
}

async function notifySaved(reason) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  clients.forEach(c => c.postMessage({ type: 'saved-copy', reason }));
}

// Serve a cached response, marked so the page can say it is a saved copy.
async function savedCopy(cached, isNav, reason) {
  const headers = new Headers(cached.headers);
  headers.set('x-saved-copy', '1');
  headers.delete('content-length');
  headers.delete('content-encoding');
  let body;
  if (isNav) {
    body = (await cached.text()).replace('<head>', '<head><meta name="saved-copy" content="1">');
  } else {
    body = await cached.arrayBuffer();
  }
  notifySaved(reason);
  return new Response(body, { status: cached.status, statusText: cached.statusText, headers });
}

// Network first with a short timeout, falling back to the cache.
async function networkFirst(event) {
  const request = event.request;
  const isNav = request.mode === 'navigate';
  const key = cacheKey(request);
  const cache = await caches.open(CACHE);

  const net = fetch(request).then(async res => {
    if (isGood(res)) { await cache.put(key, res.clone()); return { res, good: true }; }
    return { res, good: false };
  }).catch(() => ({ res: null, good: false }));
  event.waitUntil(net);

  const timeout = new Promise(resolve => setTimeout(() => resolve(null), NET_TIMEOUT_MS));
  const first = await Promise.race([net, timeout]);
  if (first && first.good) return first.res;

  const cached = (await cache.match(key, { ignoreSearch: true })) || (isNav ? await cache.match(SCOPE) : null);
  if (cached) {
    const reason = first === null ? 'slow' : first.res ? 'bad-response' : 'offline';
    return savedCopy(cached, isNav, reason);
  }
  // No saved copy: let the real response through (for example the login page on a first visit).
  const final = first || await net;
  return final.res || Response.error();
}

async function cacheFirst(event) {
  const request = event.request;
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (isGood(res)) await cache.put(request, res.clone());
    return res;
  } catch (e) {
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.origin + url.pathname === SW_URL) return;
  // "Log in" link in the saved-copy banner: let the request reach the network untouched so the
  // Vercel login page can load (otherwise the saved copy would always win over the login redirect).
  if (url.searchParams.has('login')) return;
  if (request.mode === 'navigate' || DATA_URLS.has(url.origin + url.pathname)) {
    event.respondWith(networkFirst(event));
  } else {
    event.respondWith(cacheFirst(event));
  }
});
