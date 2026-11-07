# Offline and installing

Epic #10.

## The service worker (#94)

`web/src/pwa/sw.js` is the source. The build (`serviceWorker()` in `web/vite.config.ts`) writes it to `dist/sw.js`
with the list of files to precache: `index.html`, the favicon, the manifest, and every hashed script, style and
WASM file in `assets/` (no source maps, no `.gz` copies). Its version is a hash of that list, so an unchanged build
keeps the cache.

- Hashed files are cache-first. A new build has new names, so a new kernel replaces only itself.
- Page loads get the cached `index.html`, so the editor opens with no network. `/api` and share links (`/view/`)
  always go to the network and are never cached, so nothing signed-in is stored by the worker.
- Cached responses keep COOP and COEP, which the kernel needs.
- A new version waits. The page shows "BetterCad updated. Reload" (`UpdateBanner`), and only that button asks the
  worker to take over; the model is autosaved on the way out.
- Settings → Offline shows how much the cached app uses, with **Clear cached app** (autosaves stay).

It registers only in production builds (`main.tsx`). Playwright blocks service workers except in `pwa.spec.ts`, which
checks that a reload makes no network requests for the shell or the WASM and that the editor and kernel work offline.

## Offline with an account (#96)

- A cloud save that can't reach the server waits in IndexedDB (`cloudQueue`, the newest per model) and goes when the
  browser is back online or the tab comes back into view; the status says "Saved 2 queued changes". A clash with a
  newer version opens the usual "changed in another tab" dialog.
- The cloud icon shows Offline while the network is gone.
- The library keeps its last list (`cloudCache`), and shows it read-only with a banner when offline. The last 10
  opened models are kept too, so they open offline from the copy of your last visit.

## Installing (#95, in part)

`web/public/manifest.webmanifest` makes the app installable with the cube favicon as a placeholder icon, and lists
`.bcad` as a file it handles. The real icon set, screenshots, the install button and `launchQueue` wait for Kev's
logo.
