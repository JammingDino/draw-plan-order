/* Service worker — makes the installed app start without the dev server.
   Network first, cache as the fallback: edits to the source show up straight
   away while you are working on it, and the app still opens with nothing
   running (or no network) because every response is kept in the cache. */
const CACHE = 'dpo-v8';
const ASSETS = [
  './', './index.html', './css/app.css', './manifest.webmanifest',
  './css/calc.css', './css/cad.css', './css/press.css', './css/inkmath.css',
  './js/util.js', './js/ext.js', './js/freehand.js', './js/recognize.js', './js/scene.js',
  './js/camera.js', './js/render.js', './js/preview.js', './js/store.js', './js/editor.js', './js/taps.js',
  './js/tools.js', './js/ui.js', './js/app.js', './js/pdf.js', './js/perf.js', './js/desktop.js',
  './js/math.js', './js/calc.js', './js/cad.js', './js/press.js', './js/inkmath.js',
  './vendor/mathjs/math.min.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => { });
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
