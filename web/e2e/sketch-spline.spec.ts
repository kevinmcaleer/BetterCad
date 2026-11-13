import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/**
 * Splines (#269): B in a sketch, click the points a curve passes through and press Enter for an open one, then click
 * round and back on the first point for a closed one, and extrude that 5 mm.
 */
test("draw an open and a closed spline, and extrude the closed one", async ({ page }) => {
  test.setTimeout(90_000);
  const ed = await new Editor(page).open();
  await ed.view.preset("top");
  await page.keyboard.press("k");
  await expect(ed.said("Click a face or a plane to sketch on it.").first()).toBeVisible();
  await ed.view.clickUntil(30, 30, 0, ed.sketchTools);
  await page.waitForTimeout(800);
  await page.keyboard.press("b");
  await expect(ed.sketchTools.getByRole("button", { name: /^Spline/ })).toHaveAttribute("aria-pressed", "true");

  // Enter ends the open spline, not the sketch.
  await ed.view.click(-40, 20);
  await ed.view.click(-30, 28);
  await ed.view.click(-20, 20);
  await page.keyboard.press("Enter");
  await expect(ed.sketchTools).toBeVisible();

  // Back on the first point closes it.
  await ed.view.click(12, 0);
  await ed.view.click(2, 10);
  await ed.view.click(-10, 4);
  await ed.view.click(-6, -9);
  await ed.view.click(12, 0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(ed.said("Finished Sketch 1")).toBeVisible();

  await page.keyboard.press("e");
  const distance = ed.field("Distance");
  await ed.view.clickUntil(1, 1, 0, distance);
  await distance.fill("5");
  await distance.press("Enter");
  await expect(ed.said("Extruded one shape 5 mm")).toBeVisible();
  await ed.kernelReady();
  await expect(page.getByRole("treeitem", { name: /Body 1/ })).toBeVisible();
});
