// Offline support: precache the app shell, serve it straight from the cache when the app opens,
// network-first for other pages (privacy, terms, …), cache-first for built assets.
// New versions still arrive promptly: sw.js changes on every build, so the browser installs the new worker,
// which precaches the new shell, and the app reloads on controllerchange (see main.tsx).
// API calls (Supabase) are never cached — offline writes are queued in the app's outbox instead.
const CACHE = 'momig-__VERSION__';
const ASSETS = __ASSETS__;

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('momig-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (e.request.mode === 'navigate') {
    // The app itself: answer from this version's precache with no network wait, so opening the app
    // (especially the Android app) shows Bebig straight away instead of a blank screen.
    if (url.pathname === '/' || url.pathname === '/index.html') {
      e.respondWith(caches.open(CACHE).then(c => c.match('/index.html')).then(hit => hit || fetch(e.request, { cache: 'no-cache' })));
      return;
    }
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).catch(() => caches.match('/index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  })));
});
