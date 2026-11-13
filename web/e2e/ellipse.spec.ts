import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/** Ellipse (#401): E in a sketch, the centre, 20 Tab 8 Enter, then extrude it 5 mm: an elliptical puck. */
test("draw a 20 × 8 mm ellipse and extrude it", async ({ page }) => {
  test.setTimeout(90_000);
  const ed = await new Editor(page).open();
  await ed.view.preset("top");
  await page.keyboard.press("k");
  await expect(ed.said("Click a face or a plane to sketch on it.").first()).toBeVisible();
  await ed.view.clickUntil(30, 30, 0, ed.sketchTools);
  await page.waitForTimeout(800);
  await page.keyboard.press("e");
  await ed.view.click(0, 0);
  // Away from 10 mm, so the typed 20 differs from the live size and is taken as typed.
  await ed.view.hover(6.3, 0.1);
  await ed.field("First axis").fill("20");
  await page.keyboard.press("Tab");
  await ed.field("Second axis").fill("8");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "20 mm", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "8 mm", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(ed.said("Finished Sketch 1")).toBeVisible();

  await page.keyboard.press("e");
  const distance = ed.field("Distance");
  await ed.view.clickUntil(0, 0, 0, distance);
  await distance.fill("5");
  await distance.press("Enter");
  await expect(ed.said("Extruded one shape 5 mm")).toBeVisible();
  await ed.kernelReady();
  await expect(page.getByRole("treeitem", { name: /Body 1/ })).toBeVisible();
});
