// Lets the installed app open without a connection. Network first, so a redeploy shows up on the next launch;
// the cache is only the fallback. The Supabase library (jsDelivr) is cached too so the app can start; data never is.
const CACHE = 'hub-v4';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'learn.js', 'links.js', 'text.js', 'sound.js', 'remind.js', 'week.js', 'config.js', 'icon.svg', 'manifest.webmanifest', 'fonts/unbounded.woff2'];

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

// Daily reminder from the "remind" Edge Function. The badge shows how many cards are due.
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data?.json() ?? {}; } catch { m = { body: e.data?.text() }; }
  e.waitUntil(Promise.all([
    self.registration.showNotification(m.title || 'Hub', { body: m.body || "Today's track is ready.", icon: 'icon-192.png', tag: 'daily', data: { url: m.url || './#learn' } }),
    Number.isInteger(m.badge) ? self.navigator.setAppBadge?.(m.badge)?.catch(() => {}) : null,
  ]));
});
// Tapping it opens Hub, or brings an open Hub window to the front.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((open) => open.length ? open[0].focus() : clients.openWindow(e.notification.data?.url || './')));
});
