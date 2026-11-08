import { expect, test, devices, type CDPSession, type Page } from "@playwright/test";

// Sketching on a tablet: every drawing tool works by taps, or by one drag for two-point shapes.
// Scale 1: the software renderer in CI draws a 2x iPad screen too slowly.
test.use({ ...devices["iPad Pro 11"], deviceScaleFactor: 1, defaultBrowserType: undefined });

type View = { __bcView: { project(p: number[]): { x: number; y: number }; preset(p: string): void } };
type P = { x: number; y: number };

/** Where a sketch point is on the page, once the camera has stopped turning to face the sketch. */
async function at(page: Page, x: number, y: number): Promise<P> {
  const where = () => page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, 0]);
  let q = await where();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(50);
    const r = await where();
    if (Math.abs(r.x - q.x) < 0.5 && Math.abs(r.y - q.y) < 0.5) break;
    q = r;
  }
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  return { x: box.x + q.x, y: box.y + q.y };
}

async function finger(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", p?: P) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 0 }] : [] });
}

async function tap(page: Page, x: number, y: number) {
  const p = await at(page, x, y);
  await page.touchscreen.tap(p.x, p.y);
}

/** One finger down at a, slid to b, lifted. */
async function drag(page: Page, cdp: CDPSession, a: [number, number], b: [number, number]) {
  const p = await at(page, ...a);
  const q = await at(page, ...b);
  await finger(cdp, "touchStart", p);
  for (let i = 1; i <= 8; i++) await finger(cdp, "touchMove", { x: p.x + ((q.x - p.x) * i) / 8, y: p.y + ((q.y - p.y) * i) / 8 });
  await finger(cdp, "touchEnd");
}

async function startSketch(page: Page) {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Sketch/ })
    .tap();
  await tap(page, 20, 20);
  await expect(page.getByRole("toolbar", { name: "Sketch tools" })).toBeVisible();
  await page.waitForTimeout(800);
}

async function pick(page: Page, tool: string) {
  const b = page.getByRole("toolbar", { name: "Sketch tools" }).getByRole("button", { name: tool, exact: true });
  if ((await b.getAttribute("aria-pressed")) !== "true") await b.tap();
  await expect(b).toHaveAttribute("aria-pressed", "true");
}

const curves = (page: Page) => page.evaluate(() => document.querySelector(".bc-help")?.textContent ?? "");

test("a rectangle takes two taps", async ({ page }) => {
  await startSketch(page);
  await pick(page, "Rectangle");
  await tap(page, -10, -10);
  await tap(page, 15, 8);
  await expect.poll(() => curves(page)).toContain("4 degrees of freedom");
});

test("a rectangle can be dragged out with one finger", async ({ page }) => {
  await startSketch(page);
  const cdp = await page.context().newCDPSession(page);
  await pick(page, "Rectangle");
  await drag(page, cdp, [-10, -10], [15, 8]);
  await expect.poll(() => curves(page)).toContain("4 degrees of freedom");
  // A line too: down at one end, up at the other.
  await pick(page, "Line");
  await drag(page, cdp, [-10, 20], [15, 25]);
  await expect.poll(() => curves(page)).toContain("8 degrees of freedom");
});

test("circle and polygon take two taps, an arc three", async ({ page }) => {
  await startSketch(page);
  await pick(page, "Circle");
  await tap(page, -15, 0);
  await tap(page, -8, 0);
  await expect.poll(() => curves(page)).toContain("3 degrees of freedom");
  await pick(page, "Polygon");
  await tap(page, 15, 0);
  await tap(page, 22, 0);
  // A regular polygon: centre, radius and turn.
  await expect.poll(() => curves(page)).toContain("7 degrees of freedom");
  await pick(page, "Arc");
  await tap(page, 0, 15);
  await tap(page, 10, 15);
  await tap(page, 5, 20);
  // An arc: centre, radius and two end angles.
  await expect.poll(() => curves(page)).toContain("12 degrees of freedom");
});

test("the tool bar rises above an on-screen keyboard", async ({ page }) => {
  await startSketch(page);
  const bar = page.locator(".bc-stage-bars .bc-armed").last();
  const before = (await bar.boundingBox())!;
  const height = page.viewportSize()!.height;
  // Headless Chromium has no on-screen keyboard: say one covers the bottom 400px, as Safari's visual viewport would.
  await page.locator(".bc-app").evaluate((el: HTMLElement) => el.style.setProperty("--bc-keyboard", "400px"));
  await expect.poll(async () => (await bar.boundingBox())!.y + (await bar.boundingBox())!.height).toBeLessThanOrEqual(height - 400);
  await page.locator(".bc-app").evaluate((el: HTMLElement) => el.style.setProperty("--bc-keyboard", "0px"));
  await expect.poll(async () => (await bar.boundingBox())!.y).toBeCloseTo(before.y, 0);
});
