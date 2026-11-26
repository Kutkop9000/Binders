// Pokédex Binders service worker: offline app shell + cached card images and card lists.
// Bump this number on every change: it is also the version shown next to the app title.
const SHELL = 'pb-shell-v19', IMG = 'pb-img-v1', API = 'pb-api-v1';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './sync.js?v=9', './firebase-config.js', './set-names.js?v=8', './names-intl.json', './art-fill.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => ![SHELL, IMG, API].includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function cacheFirst(req, name) {
  const c = await caches.open(name), hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') c.put(req, res.clone());
  return res;
}
async function networkFirst(req, name) {
  const c = await caches.open(name);
  try { const res = await fetch(req.url, { cache: 'no-cache' }); if (res.ok) c.put(req, res.clone()); return res; }
  catch (err) { const hit = await c.match(req); if (hit) return hit; throw err; }
}
async function staleWhileRevalidate(req, name) {
  const c = await caches.open(name), hit = await c.match(req);
  const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (['assets.tcgdex.net', 'images.pokemontcg.io', 'images.scrydex.com', 'limitlesstcg.nyc3.cdn.digitaloceanspaces.com'].includes(url.hostname)) return e.respondWith(cacheFirst(req, IMG));
  // Firebase SDK (versioned URLs): keep a copy so sign-in still loads offline.
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) return e.respondWith(cacheFirst(req, SHELL));
  if (url.hostname === 'api.tcgdex.net') {
    // Single card (prices) → fresh when online; lists and sets → instant from cache, refreshed in background.
    const single = /\/cards\/[^/?]+$/.test(url.pathname);
    return e.respondWith(single ? networkFirst(req, API) : staleWhileRevalidate(req, API));
  }
  if (url.origin === location.origin) return e.respondWith(networkFirst(req, SHELL));
});
