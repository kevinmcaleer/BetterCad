import { expect, test } from "@playwright/test";
import { Editor, runCommand } from "./pages/editor";

/** Drawing from sketches: one drawing with a page for each sketch, face on, with the sketch's own sizes. */
test("make a drawing from the sketches, a page each with their sizes", async ({ page }) => {
  test.setTimeout(120_000);
  const ed = await new Editor(page).open();
  await ed.view.preset("top");
  await page.keyboard.press("k");
  await ed.view.clickUntil(30, 30, 0, ed.sketchTools);
  await page.waitForTimeout(800);
  // A 30 by 20 rectangle, its sizes typed in.
  await page.keyboard.press("r");
  await ed.view.click(-10, -10);
  await ed.view.hover(10, 5);
  await ed.field("Width").fill("30");
  await page.keyboard.press("Tab");
  await ed.field("Height").fill("20");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "30 mm", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(ed.said("Finished Sketch 1")).toBeVisible();

  await runCommand(page, "Drawing from sketches");
  await expect(page.getByRole("status").filter({ hasText: /^Added a page to Sketches/ })).toBeVisible({ timeout: 30_000 });
  // It opens on the sketch's page, the sketch seen from above with both sizes.
  await expect(page.getByRole("region", { name: "Drawing: Sketches" })).toBeVisible();
  await expect(page.locator(".bc-view")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Top view, / })).toBeVisible();
  await expect(page.locator(".bc-view .bc-view-visible").first()).toHaveAttribute("d", /L/, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Dimension, 30 mm" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dimension, 20 mm" })).toBeVisible();

  // Run again from the model: the sketch has its page, so nothing is added.
  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Select/ })
    .click();
  await runCommand(page, "Drawing from sketches");
  await expect(page.getByRole("status").filter({ hasText: "Every sketch already has a page." })).toBeVisible();
});
