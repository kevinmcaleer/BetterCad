import { expect, test, type Page } from "@playwright/test";
import { Editor } from "./pages/editor";

/**
 * Slice, as in Fusion: while a sketch is open, the palette's Slice option hides the model on the camera's side of the
 * sketch's plane, so a sketch inside a part shows. Each sketch starts with it off, and the cut goes when it finishes.
 */

type Cut = { normal: number[]; origin: number[]; offset: number } | null;
const cut = (page: Page) => page.evaluate(() => (window as unknown as { __bcView: { section: Cut } }).__bcView.section);

/** A 40 × 30 × 10 mm box centred on the origin. */
async function box(page: Page) {
  const ed = await new Editor(page).open();
  await ed.view.preset("top");
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
  await page.keyboard.press("Enter");
  await expect(ed.said("Finished Sketch 1")).toBeVisible();
  await page.keyboard.press("e");
  const distance = ed.field("Distance");
  await ed.view.clickUntil(0, 0, 0, distance);
  await distance.fill("10");
  await distance.press("Enter");
  await expect(ed.said("Extruded one shape 10 mm")).toBeVisible();
  await ed.kernelReady();
  await page.waitForTimeout(800);
  return ed;
}

test("slice hides the model in front of the sketch until it finishes", async ({ page }) => {
  test.setTimeout(90_000);
  const ed = await box(page);

  // A sketch on the XZ plane, through the middle of the box, seen from the front.
  await ed.view.preset("front");
  await page.keyboard.press("k");
  await ed.view.clickUntil(35, 0, 15, ed.sketchTools);
  await expect(ed.said(/Sketching on the XZ plane/)).toBeVisible();
  const slice = page.getByRole("checkbox", { name: "Slice" });
  await expect(slice).not.toBeChecked();
  expect(await cut(page)).toBeNull();

  await slice.check();
  // The front looks along +Y, so the cut keeps the far half: everything at y > 0.
  await expect.poll(async () => (await cut(page))?.normal.map((v) => Math.round(v))).toEqual([0, -1, 0]);

  await page.evaluate(() => (window as unknown as { __bcView: { preset(p: string): void } }).__bcView.preset("iso"));
  await page.waitForTimeout(1200);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/sketch-slice.png` });

  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(ed.said(/Finished Sketch 2/)).toBeVisible();
  await expect.poll(() => cut(page)).toBeNull();

  // The next sketch starts with the whole model on show.
  await page.keyboard.press("k");
  await ed.view.clickUntil(35, 0, 15, ed.sketchTools);
  await expect(page.getByRole("checkbox", { name: "Slice" })).not.toBeChecked();
});
