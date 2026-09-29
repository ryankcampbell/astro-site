/* Astronomy — service worker.  Model: calc-site's sw.js (student_site_plan.md §4).

   CACHE_VERSION is stamped by deploy.py from a hash of the shell files; do not edit it.
     index.json          network-first (new days must appear), cached copy when offline
     d/ p/ s/ documents   cache-first; requested as file?h=<hash>, so a changed file is a new URL
     the shell            cache-first, revalidated in the background
   Documents are cached when first opened, never pre-cached (marsmap is 18 MB). */
const CACHE_VERSION = '0c202e43f0f4';
const SHELL = `astro-shell-${CACHE_VERSION}`;
const DOCS = 'astro-docs-v1';
const SHELL_FILES = ['./', 'index.html', 'style.css', 'app.js', 'study.js', 'index.json',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'katex/katex.min.js', 'katex/auto-render.min.js', 'katex/katex.min.css'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL)
    .then(c => c.addAll(SHELL_FILES.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('astro-shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isDoc = p => /\/(d|p|s)\/[^/]+\.(html|pdf|json)$/.test(p);

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/index.json')) { event.respondWith(networkFirst(req)); return; }
  if (isDoc(url.pathname)) { event.respondWith(docFirst(req, url)); return; }
  event.respondWith(shellFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res && res.ok) cache.put(new Request(req.url), res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req.url) || await cache.match('index.json');
    if (!hit) return new Response('offline', { status: 503 });
    const h = new Headers(hit.headers); h.set('X-From-Cache', '1');
    return new Response(await hit.blob(), { status: 200, headers: h });
  }
}
async function shellFirst(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}
/* Cache-first with Range support, so a cached PDF still opens in the browser's viewer offline. */
async function docFirst(req, url) {
  const cache = await caches.open(DOCS);
  const key = url.pathname + url.search;
  let hit = await cache.match(key);
  if (!hit) {
    try {
      const res = await fetch(new Request(url.href, { cache: 'no-store' }));
      if (!res || !res.ok) return res;
      await cache.put(key, res.clone());
      sweep(cache, url.pathname, key);
      hit = res;
    } catch (e) {
      const any = await cache.match(url.pathname, { ignoreSearch: true });
      if (any) hit = any; else return new Response('Offline, and this has not been opened on this device yet.', { status: 504 });
    }
  }
  const range = req.headers.get('range');
  if (!range) return hit;
  const buf = await hit.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const start = m[1] ? parseInt(m[1], 10) : 0, end = m[2] ? parseInt(m[2], 10) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), { status: 206, headers: {
    'Content-Type': hit.headers.get('Content-Type') || 'application/octet-stream',
    'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`, 'Content-Length': String(end - start + 1) } });
}
async function sweep(cache, pathname, keep) {
  for (const r of await cache.keys()) {
    const u = new URL(r.url);
    if (u.pathname === pathname && (u.pathname + u.search) !== keep) cache.delete(r);
  }
}
