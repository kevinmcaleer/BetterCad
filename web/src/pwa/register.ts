import { useEffect, useState } from "react";

/**
 * Registers the service worker (#94) in production builds, and says when a new version is waiting. The page asks
 * the waiting worker to take over only when you click Reload, then reloads once it has.
 */
type Listener = (waiting: ServiceWorker | null) => void;
const listeners = new Set<Listener>();
let waiting: ServiceWorker | null = null;

const announce = (w: ServiceWorker | null) => {
  waiting = w;
  for (const l of listeners) l(w);
};

export function registerServiceWorker(enabled = import.meta.env.PROD) {
  if (!enabled || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // The first install takes control quietly; a replaced worker means you asked for the new version.
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").then(
      (reg: ServiceWorkerRegistration | undefined) => {
        // A blocked registration (Playwright's WebKit) resolves with nothing.
        if (!reg) return;
        const watch = (w: ServiceWorker | null) => {
          if (!w) return;
          const check = () => w.state === "installed" && navigator.serviceWorker.controller && announce(w);
          check();
          w.addEventListener("statechange", check);
        };
        watch(reg.waiting ?? reg.installing);
        reg.addEventListener("updatefound", () => watch(reg.installing));
        // Look for a new version when the tab comes back into view.
        document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void reg.update().catch(() => undefined));
      },
      () => undefined,
    );
  });
}

/** Takes the waiting version: the page reloads when it is in control. */
export function applyUpdate() {
  waiting?.postMessage({ type: "skip-waiting" });
}

export function useUpdateWaiting(): boolean {
  const [w, setW] = useState(waiting);
  useEffect(() => {
    listeners.add(setW);
    return () => void listeners.delete(setW);
  }, []);
  return !!w;
}

/** Cache Storage used by BetterCad, in bytes, where the browser says. */
export async function cachedBytes(): Promise<number | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    const detail = (e as { usageDetails?: { caches?: number } } | undefined)?.usageDetails;
    return detail?.caches ?? e?.usage ?? null;
  } catch {
    return null;
  }
}

/** Removes the cached app; the next load fetches it again. Autosaves (IndexedDB) are kept. */
export async function clearCachedApp() {
  for (const key of await caches.keys()) if (key.startsWith("bettercad-")) await caches.delete(key);
  const regs = await navigator.serviceWorker?.getRegistrations?.();
  for (const r of regs ?? []) await r.unregister();
}
