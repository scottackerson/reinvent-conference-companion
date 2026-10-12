/* Retired service worker. Copied into public/sw.js by build.mjs (do not edit the public copy).
   Earlier versions cached the site for offline use. The site is online only now, so this version deletes those
   caches, unregisters itself and reloads open pages, so a phone that installed the old worker gets the live
   site again. It can be deleted after re:Invent 2026, once every phone has picked it up. */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('reinvent-')).map(k => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.navigate(c.url).catch(() => {}));
  })());
});
