// Cache only the public app shell. Private user data and photos are never cached here.
const CACHE = 'azice-shell-v2-mascot';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/cloud.js', '/demo.js', '/config.js', '/push-sw.js', '/manifest.webmanifest', '/assets/azice-pwa-192-v2.png', '/assets/azice-pwa-512-v2.png', '/assets/azice-maskable-512-v2.png', '/assets/azice-apple-touch-180-v2.png', '/assets/azice-favicon-16-v2.png', '/assets/azice-favicon-32-v2.png', '/assets/demo-beer.svg'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
importScripts('/push-sw.js');
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/config.js') return; // configuration may change
  if (!ASSETS.includes(url.pathname)) return;
  e.respondWith(fetch(e.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
    }
    return response;
  }).catch(() => caches.match(e.request)));
});
