import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/** A long press where two lines lie on top of each other lists both, so the one underneath can be picked. */
test("long-press a line to pick the one underneath", async ({ page }) => {
  test.setTimeout(90_000);
  const ed = await new Editor(page).open();
  await ed.view.preset("top");
  await page.keyboard.press("k");
  await expect(ed.said("Click a face or a plane to sketch on it.").first()).toBeVisible();
  await ed.view.clickUntil(30, 30, 0, ed.sketchTools);
  await page.waitForTimeout(800);
  // A short line, then a long one drawn over it.
  await ed.view.click(10, 5);
  await ed.view.click(30, 5);
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await page.keyboard.press("l");
  await ed.view.click(0, 5);
  await ed.view.click(40, 5);
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");

  const list = page.getByRole("menu", { name: "Pick what's under the pointer" });
  const longPress = async (x: number, y: number) => {
    const p = await ed.view.at(x, y);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
  };
  await longPress(20, 5);
  await expect(list).toBeVisible();
  await expect(list.getByRole("menuitem")).toHaveText(["Line 40 mm", "Line 20 mm"]);
  await list.getByRole("menuitem", { name: "Line 20 mm" }).click();
  await expect(list).toBeHidden();
  // The short line was the pick: deleting it leaves the long one, alone, so a long press lists nothing.
  await page.keyboard.press("Delete");
  await longPress(20, 5);
  await page.waitForTimeout(300);
  await expect(list).toBeHidden();
  await ed.view.click(35, 5);
  await page.keyboard.press("m");
  await expect(page.getByRole("button", { name: "Shapes (1)" })).toBeVisible();
});
