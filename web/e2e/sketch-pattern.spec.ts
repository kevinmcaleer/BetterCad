import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/**
 * Sketch Pattern: draw a circle, pick Pattern, click the circle. The copies show at once, a count typed in the panel
 * changes them, a circle pattern turns them round the origin, and the copies are shapes the sketch can extrude.
 */
test("pattern a circle in a row, then round the origin", async ({ page }) => {
  test.setTimeout(90_000);
  const ed = await new Editor(page).open();
  await ed.view.preset("top");
  await page.keyboard.press("k");
  await expect(ed.said("Click a face or a plane to sketch on it.").first()).toBeVisible();
  await ed.view.clickUntil(30, 30, 0, ed.sketchTools);
  await page.waitForTimeout(800);
  await page.keyboard.press("c");
  await ed.view.click(10, 10);
  await ed.view.click(15, 10);
  await page.keyboard.press("Escape");

  await ed.sketchTools.getByRole("button", { name: /^Pattern/ }).click();
  const panel = page.getByRole("group", { name: "Pattern options" });
  await expect(panel.getByText("Click the shapes to copy")).toBeVisible();
  await ed.view.click(15, 10);
  await expect(panel.getByRole("button", { name: "1 shape" })).toBeVisible();
  await expect(panel.getByText(/3 in a row, 12 mm apart/)).toBeVisible();

  const count = panel.getByRole("textbox", { name: /^Count/ });
  await count.fill("4");
  await count.press("Tab");
  await expect(panel.getByText(/4 in a row, 12 mm apart/)).toBeVisible();

  await panel.getByRole("button", { name: "Circle" }).click();
  await expect(panel.getByRole("button", { name: "Origin" })).toBeVisible();
  await expect(panel.getByText(/6 round a point/)).toBeVisible();
  await panel.getByRole("button", { name: "OK" }).click();
  await expect(ed.said("Patterned: 6 round a point")).toBeVisible();

  // The pattern's numbers are named sizes in the palette.
  await expect(page.getByRole("textbox", { name: /^Pattern count 1 \(d\d+\)/ })).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(ed.said("Finished Sketch 1")).toBeVisible();
  await page.keyboard.press("e");
  const distance = ed.field("Distance");
  await ed.view.clickUntil(10, 10, 0, distance);
  await distance.fill("5");
  await distance.press("Enter");
  await expect(ed.said(/Extruded/)).toBeVisible();
});
