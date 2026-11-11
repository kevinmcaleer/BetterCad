import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/**
 * Offset, part two (#266): click inside a rectangle to copy its outline inward on one distance, change that distance
 * from its one size, then copy a line to both sides.
 */
test("offset a rectangle's outline from inside it, resize it, and a line both sides", async ({ page }) => {
  test.setTimeout(90_000);
  const ed = await new Editor(page).open();
  await ed.view.preset("top");
  await page.keyboard.press("k");
  await expect(ed.said("Click a face or a plane to sketch on it.").first()).toBeVisible();
  await ed.view.clickUntil(30, 30, 0, ed.sketchTools);
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
  await ed.view.click(-20, -10);
  await ed.view.click(20, 10);
  const constraints = page.getByRole("list", { name: "Constraints" }).getByRole("listitem");
  await expect(constraints).toHaveCount(4);

  await page.keyboard.press("o");
  await page.getByRole("textbox", { name: "Distance" }).fill("2");
  await page.keyboard.press("Enter");
  await ed.view.click(6, 4);
  // Four parallels join the rectangle's four; the four distances are one size.
  await expect(constraints).toHaveCount(8);
  const two = page.getByRole("button", { name: "2 mm", exact: true });
  await expect(two).toHaveCount(1);
  await two.dblclick();
  await page.getByRole("textbox", { name: "Size in mm" }).fill("4");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "4 mm", exact: true })).toHaveCount(1);

  // A line, copied both sides at once.
  await page.keyboard.press("Escape");
  await page.keyboard.press("l");
  await ed.view.click(-40, 25);
  await ed.view.click(-10, 25);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const before = await constraints.count();
  await page.keyboard.press("o");
  await page.getByRole("button", { name: "Both sides" }).click();
  await ed.view.click(-25, 25);
  await expect(constraints).toHaveCount(before + 2);
});
