import { expect, test, type Page } from "@playwright/test";
import { Editor } from "./pages/editor";

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

  // It follows the pointer, so it moves across with it, still above it.
  await page.mouse.move(b.x + 20, b.y, { steps: 4 });
  await expect(loupe).toBeVisible();
  const moved = (await loupe.boundingBox())!;
  expect(moved.x + moved.width / 2).toBeCloseTo(b.x + 20, -1);
  // Back on the second point, it picks that point.
  await page.mouse.move(b.x, b.y, { steps: 4 });
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

test("the loupe shows the sketch's lines at full width, on a view turned upside down", async ({ page }) => {
  const ed = await new Editor(page).open();
  await ed.view.preset("top");
  await page.keyboard.press("k");
  await ed.view.clickUntil(20, 20, 0, ed.sketchTools);
  await page.waitForTimeout(800);
  // Turned half way round with the view cube, as when a sketch is seen from underneath.
  const turn = page.getByRole("group", { name: "View cube" }).getByRole("button", { name: "Turn clockwise 90°" });
  for (let i = 0; i < 2; i++) {
    await turn.click();
    await page.waitForTimeout(700);
  }

  // A line across, with two points almost on top of each other in its middle: a crowd the loupe opens over.
  await ed.view.click(-20, 5);
  await ed.view.click(20, 5);
  await page.keyboard.press("Escape");
  await page.keyboard.press("p");
  await placePoint(page, 0, 5);
  await placePoint(page, 0.02, 5);
  await page.keyboard.press("Escape");
  const m = await at(page, 0.01, 5);
  await page.mouse.move(m.x + 40, m.y + 40, { steps: 2 });
  await page.mouse.move(m.x, m.y, { steps: 4 });
  const loupe = page.locator(".bc-loupe");
  await expect(loupe).toBeVisible();
  await expect(loupe.locator(".bc-loupe-zoom")).toHaveText("40×");
  await page.waitForTimeout(500);
  await page.screenshot({ path: test.info().outputPath("loupe-turned.png") });

  // The line crosses the loupe in the sketch's colour, a pixel or more wide all the way: not a faint hairline. On a
  // busy runner the loupe can still be part drawn when first read, so read it until it settles.
  const strong = () =>
    loupe.locator("canvas").evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3]! > 200 && d[i + 2]! - d[i]! > 80) n++;
      return n / (c.width / (window.devicePixelRatio || 1));
    });
  await expect.poll(strong, { timeout: 10_000 }).toBeGreaterThan(1);
});
