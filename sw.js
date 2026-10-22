// Service worker — Fuel Analytics PRO
// Guarda a "casca" da app (HTML, manifesto, ícones) e as bibliotecas externas para abrir sem rede.
// NUNCA intercepta o Supabase: dados e autenticação passam sempre direto pela rede (nada disso fica em cache aqui).
// Para publicar uma versão nova, mudar VERSAO.
const VERSAO = 'fuel-v20-14';
const CASCA = VERSAO + '-casca';
const EXTERNOS = VERSAO + '-externos';

const URLS_CASCA = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const URLS_EXTERNOS = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=Karla:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap'
];
const HOSTS_EXTERNOS = new Set(['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']);

async function guardar(nome, url) {
  const cache = await caches.open(nome);
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (r && r.ok) { await cache.put(url, r); return; }
  } catch (e) { /* tenta sem CORS */ }
  try {
    const r = await fetch(url, { mode: 'no-cors' });
    if (r) await cache.put(url, r);
  } catch (e) { /* sem rede na instalação: fica para a próxima */ }
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    await Promise.all([
      ...URLS_CASCA.map((u) => guardar(CASCA, u)),
      ...URLS_EXTERNOS.map((u) => guardar(EXTERNOS, u))
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter((n) => n.startsWith('fuel-') && n !== CASCA && n !== EXTERNOS).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// Mostra o que há em cache já, e actualiza em segundo plano (a versão nova aparece na abertura seguinte)
async function cacheDepoisRede(e, req, nome, opcoes) {
  const cache = await caches.open(nome);
  const guardado = await cache.match(req, opcoes);
  const rede = fetch(req).then((r) => {
    if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone());
    return r;
  });
  if (guardado) { e.waitUntil(rede.catch(() => {})); return guardado; }
  try { return await rede; }
  catch (err) { return null; }
}

async function navegacao(e, req) {
  const cache = await caches.open(CASCA);
  const guardado = (await cache.match(req, { ignoreSearch: true }))
    || (await cache.match('./')) || (await cache.match('./index.html'));
  const rede = fetch(req).then((r) => {
    if (r && r.ok) { cache.put(req, r.clone()); }
    return r;
  });
  if (guardado) { e.waitUntil(rede.catch(() => {})); return guardado; }
  try { return await rede; }
  catch (err) {
    return new Response('Sem ligação e sem cópia guardada. Abra a app uma vez com internet.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
  if (url.hostname.endsWith('.supabase.co')) return;            // dados e login: sempre rede, nunca cache
  if (req.mode === 'navigate') { e.respondWith(navegacao(e, req)); return; }
  if (url.origin === self.location.origin) {
    e.respondWith(cacheDepoisRede(e, req, CASCA, { ignoreSearch: true }).then((r) => r || fetch(req)));
    return;
  }
  if (HOSTS_EXTERNOS.has(url.hostname)) {
    e.respondWith(cacheDepoisRede(e, req, EXTERNOS).then((r) => r || fetch(req)));
  }
});
