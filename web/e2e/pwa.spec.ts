import { expect, test, type Page } from "@playwright/test";
import { Editor } from "./pages/editor";

/** The service worker (#94) and working offline (#96). */
test.use({ serviceWorkers: "allow" });

type Bodies = { __bcView: { bodies: Map<string, { body: { world?: boolean } }> } };
const kernelSolids = (page: Page) => page.evaluate(() => [...(window as unknown as Bodies).__bcView.bodies.values()].filter((o) => o.body.world).length);

test("the second visit comes from the cache, and the editor and kernel work offline", async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  // The worker installs (precaching the app) and takes control.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }));
  });
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });

  // Only requests made by the second visit count: the first visit's kernel may still be downloading its WASM (23 MB)
  // from the network when the listener starts, and that response would land here.
  const network: string[] = [];
  const second = new Set<object>();
  let counting = false;
  page.on("request", (r) => {
    if (counting) second.add(r);
  });
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (second.has(r.request()) && u.origin === "http://127.0.0.1:4173" && !u.pathname.startsWith("/api/") && !r.fromServiceWorker()) network.push(u.pathname);
  });
  counting = true;
  await page.reload();
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Cylinder", exact: true }).click();
  await expect.poll(() => kernelSolids(page), { timeout: 60_000 }).toBe(1);
  expect(network.filter((p) => p === "/" || p.endsWith(".js") || p.endsWith(".css") || p.endsWith(".wasm"))).toEqual([]);

  // Offline: the app opens, models build, and the cached app is listed in Settings.
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: /Box 1/ })).toBeVisible();
  await expect.poll(() => kernelSolids(page), { timeout: 60_000 }).toBe(1);
  await new Editor(page).panel("Settings");
  await expect(page.getByRole("button", { name: "Clear cached app" })).toBeVisible();
  await expect(page.getByText(/opens offline, using \d+ MB/)).toBeVisible();
  await context.setOffline(false);
});
