import { expect, test, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number }; preset(p: string): void } };

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

test("extrude a sketched rectangle into a body", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);

  // A 30 × 20 mm rectangle on the XY plane.
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await expect(page.getByRole("toolbar", { name: "Sketch tools" })).toBeVisible();
  await page.waitForTimeout(800);
  await page.keyboard.press("r");
  await click(page, -10, -10);
  const far = await at(page, 10, 5);
  await page.mouse.move(far.x, far.y, { steps: 3 });
  await page.getByRole("textbox", { name: "Width" }).fill("30");
  await page.keyboard.press("Tab");
  await page.getByRole("textbox", { name: "Height" }).fill("20");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "30 mm", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Finished Sketch 1")).toBeVisible();

  // E, click inside the shape, type the distance, Enter.
  await page.keyboard.press("e");
  await expect(page.getByText("Click inside a closed sketch shape to extrude it.").first()).toBeVisible();
  await click(page, 0, 0);
  const distance = page.getByRole("textbox", { name: "Distance" });
  await expect(distance).toBeFocused();
  await distance.fill("12");
  await distance.press("Enter");
  await expect(page.getByText("Extruded one shape 12 mm")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Model tools" }).getByRole("button", { name: /^Extrude/, pressed: false })).toBeVisible();

  // The body is on the timeline and in the parts list, with the kernel's exact volume.
  await expect(page.getByRole("button", { name: /Extrude 1/ }).first()).toBeVisible();
  await page.getByRole("treeitem", { name: /Body 1/ }).click();
  await expect(page.getByText("7,200 mm³")).toBeVisible({ timeout: 20_000 });

  // One undo takes the whole extrude back.
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("treeitem", { name: /Body 1/ })).toHaveCount(0);
});

test("Esc cancels an extrude", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await expect(page.getByRole("toolbar", { name: "Sketch tools" })).toBeVisible();
  await page.waitForTimeout(800);
  await page.keyboard.press("c");
  await expect(page.getByRole("button", { name: /^Circle/, pressed: true })).toBeVisible();
  await click(page, 0, 0);
  const edge = await at(page, 6, 0);
  await page.mouse.move(edge.x, edge.y, { steps: 3 });
  await page.getByRole("textbox", { name: "Diameter" }).fill("16");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Finished Sketch 1")).toBeVisible();

  await page.keyboard.press("e");
  await click(page, 0, 0);
  await expect(page.getByRole("group", { name: "Operation" }).getByRole("button", { name: "New body", pressed: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Extrude 1/ })).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: /Body 1/ })).toHaveCount(0);
});
