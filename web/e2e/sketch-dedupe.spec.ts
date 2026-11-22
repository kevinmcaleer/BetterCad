import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/** A line drawn twice in the same place: right-click, Remove duplicates, and one is left, in one undo step. */
test("right-click Remove duplicates takes a line drawn twice down to one", async ({ page }) => {
  test.setTimeout(90_000);
  const ed = await new Editor(page).open();
  await ed.view.preset("top");
  await page.keyboard.press("k");
  await expect(ed.said("Click a face or a plane to sketch on it.").first()).toBeVisible();
  await ed.view.clickUntil(30, 30, 0, ed.sketchTools);
  await page.waitForTimeout(800);
  for (let k = 0; k < 2; k++) {
    await ed.view.click(10, 5);
    await ed.view.click(30, 5);
    await page.keyboard.press("Escape");
  }
  await page.keyboard.press("v");

  // Nothing picked: the menu works on the whole sketch.
  const empty = await ed.view.at(-20, -20);
  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Remove duplicates" }).click();
  await expect(ed.said("Removed 1 duplicate.").first()).toBeVisible();
  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Remove duplicates" }).click();
  await expect(ed.said("No duplicates in this sketch.").first()).toBeVisible();

  // Undo brings the second line back; right-click on the line picks it, and its twin goes.
  await page.keyboard.press("Control+z");
  const line = await ed.view.at(20, 5);
  await page.mouse.move(line.x, line.y, { steps: 3 });
  await page.mouse.click(line.x, line.y, { button: "right" });
  const menu = page.getByRole("menu", { name: "Sketch actions" });
  await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Remove duplicates" }).click();
  await expect(ed.said("Removed 1 duplicate.").first()).toBeVisible();
});
