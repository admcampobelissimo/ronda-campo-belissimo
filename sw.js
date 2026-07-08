const CACHE_NAME = "ronda-cb-v6";
const STATIC_ASSETS = [
  "./vendor/jspdf.umd.min.js",
  "./assets/logo.svg",
  "./assets/logo.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Arquivos de código do app (html/js/manifest): sempre busca a versão mais nova da rede
// primeiro, e só usa o cache como reserva se o celular estiver sem internet.
const CODE_EXTENSIONS = [".html", ".js", ".webmanifest", ".json"];

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Nunca cachear/interceptar chamadas ao Supabase (login, dados, storage) —
  // precisam sempre ir direto à rede, nunca servir algo cacheado.
  if (url.hostname.endsWith(".supabase.co") || url.hostname.endsWith("supabase.in")) {
    return;
  }

  const isCode = url.pathname === "/" || CODE_EXTENSIONS.some((ext) => url.pathname.endsWith(ext));

  if (isCode) {
    // cache: "no-store" força ignorar também o cache HTTP comum do navegador,
    // não só o Cache Storage do service worker — sem isso, o fetch() abaixo
    // podia ser satisfeito por uma cópia antiga guardada pelo próprio navegador,
    // mesmo essa lógica sendo "network-first".
    const freshRequest = new Request(event.request, { cache: "no-store" });
    event.respondWith(
      fetch(freshRequest)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});
