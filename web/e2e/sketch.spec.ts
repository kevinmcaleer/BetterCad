import { expect, test, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number }; preset(p: string): void } };

/** Where a world point is on the page, measured now (the stage moves when the sketch bars appear). */
async function at(page: Page, x: number, y: number, z = 0) {
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  const q = await page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  return { x: box.x + q.x, y: box.y + q.y };
}

async function click(page: Page, x: number, y: number) {
  const p = await at(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

test("draw a sized rectangle on the XY plane and finish the sketch", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);

  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Sketch/ })
    .click();
  await expect(page.getByText("Click a face or a plane to sketch on it.").first()).toBeVisible();
  await click(page, 20, 20);
  await expect(page.getByRole("toolbar", { name: "Sketch tools" })).toBeVisible();
  await expect(page.getByText("Sketching on the XY plane. Enter finishes.")).toBeVisible();
  await page.waitForTimeout(800);

  // Rectangle: one corner, then type the width, Tab, the height, Enter.
  await page.keyboard.press("r");
  await expect(page.getByRole("button", { name: /^Rectangle/, pressed: true })).toBeVisible();
  await click(page, -10, -10);
  const far = await at(page, 10, 5);
  await page.mouse.move(far.x, far.y, { steps: 3 });
  await page.getByRole("textbox", { name: "Width" }).fill("30");
  await page.keyboard.press("Tab");
  await page.getByRole("textbox", { name: "Height" }).fill("20");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: "Constraints" }).getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "30 mm", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "20 mm", exact: true })).toBeVisible();
  await expect(page.locator(".bc-help")).toContainText("2 degrees of freedom");

  // Double-click a size to change it.
  await page.getByRole("button", { name: "30 mm", exact: true }).dblclick();
  const input = page.getByRole("textbox", { name: "Size in mm" });
  await expect(input).toBeFocused();
  await input.fill("45");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "45 mm", exact: true })).toBeVisible();

  // Undo takes back one step at a time.
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: "30 mm", exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("toolbar", { name: "Model tools" })).toBeVisible();
  await expect(page.getByText("Finished Sketch 1")).toBeVisible();
  await expect(page.getByRole("button", { name: /Sketch 1/ }).first()).toBeVisible();
});

test("an open shape asks before finishing", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await page.waitForTimeout(800);
  await click(page, 0, 0);
  await click(page, 20, 0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Finish sketch" }).click();
  await expect(page.getByText("This sketch has no closed shape yet, so it can't be extruded.")).toBeVisible();
  await page.getByRole("button", { name: "Finish anyway" }).click();
  await expect(page.getByRole("toolbar", { name: "Model tools" })).toBeVisible();
});
