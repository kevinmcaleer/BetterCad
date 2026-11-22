import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/** Double-click a sketch line to pick every curve joined to it: all three sides of a triangle, not the square. */
test("double-click a line to pick its whole outline", async ({ page }) => {
  test.setTimeout(90_000);
  const ed = await new Editor(page).open();
  await ed.view.preset("top");
  await page.keyboard.press("k");
  await expect(ed.said("Click a face or a plane to sketch on it.").first()).toBeVisible();
  await ed.view.clickUntil(30, 30, 0, ed.sketchTools);
  await page.waitForTimeout(800);
  await ed.view.click(10, 5);
  await ed.view.click(30, 5);
  await ed.view.click(20, 20);
  await ed.view.click(10, 5);
  await page.keyboard.press("Escape");
  // A square off to the side, not joined to the triangle.
  await page.keyboard.press("r");
  await ed.view.click(-30, -30);
  await ed.view.click(-20, -20);
  await page.keyboard.press("v");

  const side = await ed.view.at(20, 5);
  await page.mouse.move(side.x, side.y, { steps: 3 });
  await page.mouse.dblclick(side.x, side.y);
  // Mirror takes what is picked as its shapes.
  await page.keyboard.press("m");
  await expect(page.getByRole("button", { name: "Shapes (3)" })).toBeVisible();
});
