import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/**
 * Sketch mirror (#267): draw a triangle, M, click its three sides, then the Y axis. The copy is tied by Symmetric
 * constraints, extrudes as a second shape, and one undo takes it back.
 */
test("mirror a triangle across the Y axis", async ({ page }) => {
  test.setTimeout(90_000);
  const ed = await new Editor(page).open();
  await ed.view.preset("top");
  await page.keyboard.press("k");
  await expect(ed.said("Click a face or a plane to sketch on it.").first()).toBeVisible();
  await ed.view.clickUntil(30, 30, 0, ed.sketchTools);
  await page.waitForTimeout(800);
  // A new sketch starts with Line armed.
  await expect(ed.sketchTools.getByRole("button", { name: /^Line/ })).toHaveAttribute("aria-pressed", "true");
  await ed.view.click(10, 5);
  await ed.view.click(30, 5);
  await ed.view.click(20, 20);
  await ed.view.click(10, 5);
  await page.keyboard.press("Escape");

  const constraints = page.getByRole("list", { name: "Constraints" }).getByRole("listitem");
  const symmetric = constraints.filter({ hasText: "Symmetric" });
  await page.keyboard.press("m");
  await expect(ed.sketchTools.getByRole("button", { name: /^Mirror/ })).toHaveAttribute("aria-pressed", "true");
  await ed.view.click(20, 5);
  await ed.view.click(25, 12.5);
  await ed.view.click(15, 12.5);
  await expect(page.getByRole("button", { name: "Shapes (3)" })).toBeVisible();
  await page.getByRole("button", { name: "Mirror line" }).click();
  await ed.view.click(0, 25);
  await expect(symmetric).toHaveCount(3);

  // One undo takes the copy and the axis it was mirrored across back.
  await page.keyboard.press("Control+z");
  await expect(symmetric).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(symmetric).toHaveCount(3);

  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(ed.said("Finished Sketch 1")).toBeVisible();
  await page.keyboard.press("e");
  const distance = ed.field("Distance");
  await ed.view.clickUntil(-20, 9, 0, distance);
  await distance.fill("5");
  await distance.press("Enter");
  await expect(ed.said(/Extruded one shape 5 mm/)).toBeVisible();
});
