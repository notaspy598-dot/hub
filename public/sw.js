// Lets the installed app open without a connection. Network first, so a redeploy shows up on the next launch;
// the cache is only the fallback. The Supabase library (jsDelivr) is cached too so the app can start; data never is.
const CACHE = 'hub-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'learn.js', 'links.js', 'text.js', 'config.js', 'icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || ![location.origin, 'https://cdn.jsdelivr.net'].includes(url.origin)) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./'))));
});
