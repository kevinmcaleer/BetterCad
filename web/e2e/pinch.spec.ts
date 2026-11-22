import { expect, test, type Page } from "@playwright/test";

// A trackpad pinch is a wheel with Ctrl held. Over a floating card it zooms the 3D view, not the page.
type View = { __bcView: { project(p: number[]): { x: number; y: number } } };

/** How far apart two points 50 mm apart look on screen: grows as the view zooms in. */
const spread = (page: Page) =>
  page.evaluate(() => {
    const v = (window as unknown as View).__bcView;
    const a = v.project([0, 0, 0]),
      b = v.project([50, 0, 0]);
    return Math.hypot(a.x - b.x, a.y - b.y);
  });

test("a pinch over the browser panel zooms the view and leaves the page alone", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();
  const panel = (await page.getByRole("tree").first().boundingBox())!;
  const before = await spread(page);
  await page.mouse.move(panel.x + panel.width / 2, panel.y + 10);
  await page.keyboard.down("Control");
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -20);
  await page.keyboard.up("Control");
  await expect.poll(() => spread(page)).toBeGreaterThan(before * 1.5);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
});

test("a plain wheel over a panel still scrolls it, not the view", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();
  const before = await spread(page);
  const panel = (await page.getByRole("tree").first().boundingBox())!;
  await page.mouse.move(panel.x + panel.width / 2, panel.y + 10);
  await page.mouse.wheel(0, 40);
  await page.waitForTimeout(200);
  expect(await spread(page)).toBeCloseTo(before, 3);
});
