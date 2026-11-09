import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/**
 * Drawing snaps to the model, as Fusion does with auto project on: a line drawn on a box's top starts at the centre of
 * a separate cylinder's round top, which isn't in the sketch until the click brings it in. The loupe then shows the
 * view itself, magnified.
 */
test("a line snaps to a model circle's centre, and the loupe magnifies the model", async ({ page }) => {
  test.setTimeout(120_000);
  const ed = await new Editor(page).open();
  await ed.view.preset("top");

  // A 40 × 30 × 10 mm box round the origin, and a 10 mm cylinder 15 mm tall off to its right.
  const extrude = async (at: [number, number], mm: string) => {
    await page.keyboard.press("Enter");
    await expect(ed.said(/Finished Sketch/)).toBeVisible();
    await page.keyboard.press("e");
    const distance = ed.field("Distance");
    await ed.view.clickUntil(at[0], at[1], 0, distance);
    await distance.fill(mm);
    await distance.press("Enter");
    await expect(ed.said(new RegExp(`Extruded one shape ${mm} mm`))).toBeVisible();
    await ed.kernelReady();
  };
  await page.keyboard.press("k");
  await ed.view.clickUntil(30, 30, 0, ed.sketchTools);
  await page.waitForTimeout(800);
  await page.keyboard.press("r");
  await ed.view.click(-20, -15);
  await ed.view.hover(15, 10);
  await ed.field("Width").fill("40");
  await page.keyboard.press("Tab");
  await ed.field("Height").fill("30");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await extrude([0, 0], "10");

  await page.keyboard.press("k");
  await ed.view.clickUntil(25, 25, 0, ed.sketchTools);
  await page.waitForTimeout(800);
  await page.keyboard.press("c");
  await ed.view.click(45, 0);
  await ed.view.hover(50, 0);
  await ed.field("Diameter").fill("10");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await extrude([45, 0], "15");
  await page.waitForTimeout(800);

  // A sketch on the box's top: only the box's own edges come in.
  await page.keyboard.press("k");
  await ed.view.clickUntil(5, 5, 10, ed.sketchTools);
  await page.waitForTimeout(800);
  const circles = page.getByRole("list", { name: "Constraints" }).getByRole("listitem");
  const before = await circles.count();

  // A new sketch starts with the Line tool on.
  await ed.view.hover(45.6, 0.4, 10);
  await expect(page.locator(".bc-snap-label").filter({ hasText: "Centre" })).toBeVisible();
  await page.mouse.down();
  await page.mouse.up();
  await ed.view.click(10, 0, 10);
  // The cylinder's rim came in, held in place, and the line starts on its centre.
  await expect.poll(() => circles.count()).toBeGreaterThan(before);
  await page.keyboard.press("Escape");

  // Alt opens the loupe over the box's corner, seen from an angle.
  await page.evaluate(() => (window as unknown as { __bcView: { preset(p: string): void } }).__bcView.preset("iso"));
  await page.waitForTimeout(1500);
  await ed.view.hover(20, 15, 10);
  await page.keyboard.down("Alt");
  const loupe = page.locator(".bc-loupe");
  await expect(loupe).toBeVisible();
  await page.waitForTimeout(500);
  // The box's shaded side fills the lower left of the loupe, the ground its upper right. Drawn from the view itself the
  // two differ; the sketch alone redrawn bigger would leave both the plain view colour.
  const [side, ground] = await loupe.locator("canvas").evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext("2d")!;
    const mean = (x: number, y: number) => {
      const d = ctx.getImageData(x, y, c.width / 6, c.height / 6).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k]! += d[i + k]!;
      return sum.map((v) => v / (d.length / 4));
    };
    return [mean(c.width * 0.3, c.height * 0.6), mean(c.width * 0.6, c.height * 0.25)];
  });
  await page.screenshot({ path: test.info().outputPath("loupe-model.png") });
  expect(Math.max(...side!.map((v, i) => Math.abs(v - ground![i]!)))).toBeGreaterThan(10);
  await page.keyboard.up("Alt");
});
