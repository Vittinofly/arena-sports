/* ============================================================
   Arena Esporte: service worker do app
   - Páginas, CSS e JS: rede primeiro (sempre a versão nova),
     cópia guardada só para quando a internet cair.
   - Fontes e imagens: cópia guardada primeiro (carrega rápido).
   - Supabase, CDNs e Google Maps passam direto, sem cópia.
   - O painel (admin.html) nunca é guardado.
   Ao publicar uma versão nova, troque VERSAO.
   ============================================================ */
const VERSAO = 'arena-esporte-v1';
const ESSENCIAIS = [
  './', 'index.html', 'agendar.html', 'reserva.html', 'style.css', 'script.js', 'manifest.webmanifest',
  'js/config.js', 'js/regras.js', 'js/seed.js', 'js/dados.js', 'js/publico.js', 'js/agendar.js',
  'js/reserva.js', 'js/bilhete.js', 'js/pix.js', 'js/app.js',
  'fonts/archivo-variavel-latin.woff2', 'img/logo-arena-esporte.webp', 'img/favicon-192.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ESSENCIAIS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function redePrimeiro(req) {
  const cache = await caches.open(VERSAO);
  try {
    const resp = await fetch(req);
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch (e) {
    const guardada = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (guardada) return guardada;
    if (req.mode === 'navigate') return cache.match('agendar.html');
    throw e;
  }
}

async function cachePrimeiro(req) {
  const cache = await caches.open(VERSAO);
  const guardada = await cache.match(req);
  if (guardada) return guardada;
  const resp = await fetch(req);
  if (resp.ok) cache.put(req, resp.clone());
  return resp;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/\/admin(\.html|\.css)?$/.test(url.pathname) || url.pathname.endsWith('/js/admin.js')) return;
  if (/\.(?:woff2|webp|png|jpg|jpeg|svg|ico)$/.test(url.pathname)) {
    e.respondWith(cachePrimeiro(req));
    return;
  }
  e.respondWith(redePrimeiro(req));
});
