/* BetterCad's service worker (#94). The build (vite.config.ts, `serviceWorker()`) writes it to dist/sw.js with
 * __VERSION__ and __PRECACHE__ filled in: the shell, the hashed scripts and styles, and both WASM files.
 *
 * - Hashed files (assets/*) are cache-first: a new build has new names, so it invalidates only what changed.
 * - Pages (navigations) get the cached index.html, so the editor opens offline; share links (/view/) and /api go to
 *   the network and are never cached, so nothing signed-in is kept here.
 * - A new worker waits until the page asks it to take over (the "BetterCad updated" banner), never mid-edit.
 */
/* global __PRECACHE__ */
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const SHELL = `bettercad-shell-${VERSION}`;
const RUNTIME = "bettercad-runtime";
const ISOLATION = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
const scope = new URL(self.registration.scope);
const INDEX = new URL("index.html", scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE.map((p) => new URL(p, scope).href))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("bettercad-shell-") && key !== SHELL) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "skip-waiting") self.skipWaiting();
});

/** Cached responses keep COOP and COEP, which the kernel's threads need. */
function isolated(res) {
  if (!res || res.type === "opaque") return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(ISOLATION)) if (!headers.has(k)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const OFFLINE_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline · BetterCad</title><body style="font:15px/1.5 system-ui,sans-serif;max-width:65ch;margin:48px auto;padding:0 16px"><h1 style="font-size:20px">You're offline</h1><p>This page needs a connection. The editor works offline: <a href="./">open it</a>.</p></body>`;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== scope.origin) return;
  const path = url.pathname.slice(scope.pathname.length);
  if (path.startsWith("api/")) return;

  if (req.mode === "navigate") {
    if (path.startsWith("view/")) {
      event.respondWith(fetch(req).catch(() => new Response(OFFLINE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
      return;
    }
    event.respondWith(
      (async () => {
        const cached = await caches.match(INDEX);
        if (cached) return isolated(cached);
        try {
          return await fetch(req);
        } catch {
          return new Response(OFFLINE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(req, { ignoreSearch: path.startsWith("assets/") });
      if (cached) return isolated(cached);
      const res = await fetch(req);
      if (res.ok && (path.startsWith("assets/") || path === "favicon.svg" || path === "manifest.webmanifest")) {
        const copy = res.clone();
        event.waitUntil(caches.open(RUNTIME).then((c) => c.put(req, copy)));
      }
      return res;
    })(),
  );
});
