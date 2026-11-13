import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/**
 * Extend, and trim by dragging (#270): grow a line that stops short of another so it joins it, then drag across the
 * middle pieces of a grid to trim them all in one undo step.
 */
test("extend a line to meet another, then drag to trim a grid", async ({ page }) => {
  test.setTimeout(90_000);
  const ed = await new Editor(page).open();
  await ed.view.preset("top");
  await page.keyboard.press("k");
  await expect(ed.said("Click a face or a plane to sketch on it.").first()).toBeVisible();
  await ed.view.clickUntil(30, 30, 0, ed.sketchTools);
  await page.waitForTimeout(800);
  const line = async (a: [number, number], b: [number, number]) => {
    await ed.view.click(...a);
    await ed.view.click(...b);
    // Esc ends the chain, a second puts Line down, and L picks it up again for the next.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.keyboard.press("l");
  };
  // A new sketch starts with Line armed.
  await line([0, 0], [16, 0]);
  await line([20, -10], [20, 10]);

  const constraints = page.getByRole("list", { name: "Constraints" }).getByRole("listitem");
  await page.keyboard.press("t");
  const kinds = page.getByRole("group", { name: "Trim kind" });
  await kinds.getByRole("button", { name: "Extend" }).click();
  await ed.view.click(15, 0);
  await expect(constraints.filter({ hasText: /^On/ })).toHaveCount(1);

  // A grid: two uprights between two level lines.
  await page.keyboard.press("l");
  await line([-20, -12], [-20, 12]);
  await line([-10, -12], [-10, 12]);
  await line([-25, -6], [-5, -6]);
  await line([-25, 6], [-5, 6]);
  const vertical = constraints.filter({ hasText: /^Vertical/ });
  await expect(vertical).toHaveCount(3);

  await page.keyboard.press("t");
  await kinds.getByRole("button", { name: "Trim" }).click();
  const from = await ed.view.at(-24, 0);
  const to = await ed.view.at(-6, 0);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  // Each upright loses its middle and is left as two, each still upright.
  await expect(vertical).toHaveCount(5);
  await page.keyboard.press("Control+z");
  await expect(vertical).toHaveCount(3);
});
