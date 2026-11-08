import { expect, test, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number }; preset(p: string): void } };

async function at(page: Page, x: number, y: number) {
  const q = await page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, 0]);
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  return { x: box.x + q.x, y: box.y + q.y };
}

/** Places a point with the Point tool, Shift held so it doesn't snap to a point already there. */
async function placePoint(page: Page, x: number, y: number) {
  const p = await at(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up("Shift");
}

test("the loupe opens over points too close to pick apart, and Alt opens it anywhere", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  const plane = await at(page, 20, 20);
  await page.mouse.click(plane.x, plane.y);
  await expect(page.getByRole("toolbar", { name: "Sketch tools" })).toBeVisible();
  await page.waitForTimeout(800);

  // Two points a fraction of a millimetre apart: a pixel or two on screen.
  await page.keyboard.press("p");
  await placePoint(page, 10, -12);
  await placePoint(page, 10.3, -11.85);
  const a = await at(page, 10, -12);
  const b = await at(page, 10.3, -11.85);
  expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(8);

  const loupe = page.locator(".bc-loupe");
  await page.keyboard.press("l");
  const far = await at(page, -20, -10);
  await page.mouse.move(far.x, far.y, { steps: 2 });
  await expect(loupe).toHaveCount(0);
  // Resting on the pair opens it, zoomed in enough to tell them apart.
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await expect(loupe).toBeVisible();
  const zoom = Number((await loupe.locator(".bc-loupe-zoom").textContent())!.replace("×", ""));
  expect(zoom).toBeGreaterThanOrEqual(4);
  // It sits above the pointer.
  const box = (await loupe.boundingBox())!;
  expect(box.y + box.height).toBeLessThan(a.y);
  await page.screenshot({ path: test.info().outputPath("loupe.png") });

  // Inside the loupe the pointer moves slowly: going to where the second point shows in it picks that point.
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  await page.mouse.move(mid.x + (b.x - mid.x) * zoom, mid.y + (b.y - mid.y) * zoom, { steps: 4 });
  await expect(page.locator(".bc-snap-label")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("loupe-picked.png") });

  // Esc closes it, and moving well away keeps it shut.
  await page.keyboard.press("Escape");
  await expect(loupe).toHaveCount(0);
  await page.mouse.move(far.x, far.y, { steps: 4 });
  await expect(loupe).toHaveCount(0);

  // Alt opens it anywhere, and letting go closes it.
  await page.keyboard.down("Alt");
  await expect(loupe).toBeVisible();
  await page.keyboard.up("Alt");
  await expect(loupe).toHaveCount(0);
});
