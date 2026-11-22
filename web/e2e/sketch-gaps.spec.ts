import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/**
 * Find open ends: an outline that stops just short of where it started has no closed shape. Finish says so and rings
 * the gap with its size; Join closes it, and the shape can be finished.
 */
test("Finish rings the gap in an outline that doesn't close, and Join closes it", async ({ page }) => {
  test.setTimeout(90_000);
  const ed = await new Editor(page).open();
  await ed.view.preset("top");
  await page.keyboard.press("k");
  await ed.view.clickUntil(30, 30, 0, ed.sketchTools);
  await page.waitForTimeout(800);
  await ed.view.click(0, 0);
  await ed.view.click(40, 0);
  await ed.view.click(40, 25);
  await ed.view.click(0, 25);
  // Shift: no snapping, so the last end stops 1 mm short of the first.
  await page.keyboard.down("Shift");
  await ed.view.click(0, 1);
  await page.keyboard.up("Shift");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Enter");
  await expect(page.getByText(/no closed shape yet/)).toBeVisible();
  const list = page.getByRole("list", { name: "Open ends" });
  await expect(list).toContainText("gap between ends");
  await expect(page.locator(".bc-gap-label").first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("gap-shown.png") });

  await list.getByRole("button", { name: "Join the two ends" }).click();
  await expect(page.getByText("No open ends")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("gap-joined.png") });
  await page.getByRole("complementary", { name: "Sketch palette" }).getByRole("button", { name: "Finish sketch" }).click();
  await expect(ed.said("Finished Sketch 1")).toBeVisible();
});
