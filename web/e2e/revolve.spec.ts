import { expect, test, type Locator, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number }; preset(p: string): void } };

async function at(page: Page, x: number, y: number, z = 0) {
  // Wait for the camera to stop (finishing a sketch turns the view back), so the point is where it will be.
  const where = () => page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  let q = await where();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(50);
    const r = await where();
    if (Math.abs(r.x - q.x) < 0.5 && Math.abs(r.y - q.y) < 0.5) break;
    q = r;
  }
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  return { x: box.x + q.x, y: box.y + q.y };
}

async function click(page: Page, x: number, y: number, z = 0) {
  const p = await at(page, x, y, z);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

/** Clicks a closed sketch shape until the tool takes it (under load the first click can land before the view is ready). */
async function pickShape(page: Page, x: number, y: number, taken: Locator) {
  await expect(async () => {
    if (!(await taken.count())) await click(page, x, y);
    await expect(taken).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
}

test("revolve a rectangle round the sketch's Y axis into a tube", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);

  // A 10 × 10 mm rectangle beside the Y axis, from x = 10 to 20.
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await expect(page.getByRole("toolbar", { name: "Sketch tools" })).toBeVisible();
  await page.waitForTimeout(800);
  await page.keyboard.press("r");
  await click(page, 10, -5);
  const far = await at(page, 18, 3);
  await page.mouse.move(far.x, far.y, { steps: 3 });
  await page.getByRole("textbox", { name: "Width" }).fill("10");
  await page.keyboard.press("Tab");
  await page.getByRole("textbox", { name: "Height" }).fill("10");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Finished Sketch 1")).toBeVisible();

  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Revolve/ })
    .click();
  await pickShape(page, 15, 0, page.getByRole("button", { name: "Round the Y axis" }));
  const angle = page.getByRole("textbox", { name: "Angle" });
  await expect(angle).toHaveValue(/360/);
  await angle.press("Enter");
  await expect(page.getByText("Revolved one shape 360°")).toBeVisible();

  // π × (20² − 10²) × 10.
  await page.getByRole("treeitem", { name: /Body 1/ }).click();
  await expect(page.getByText(/9,424\.8 mm³/)).toBeVisible({ timeout: 20_000 });
});

test("push/pull the top of a box out by 5 mm", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.waitForTimeout(800);

  await page.keyboard.press("p");
  // Press on the top face and drag up: the step follows the pointer.
  const top = await at(page, 0, 0, 20);
  await page.mouse.move(top.x, top.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.move(top.x, top.y - 40, { steps: 5 });
  await page.mouse.up();
  const distance = page.getByRole("textbox", { name: "Distance" });
  await expect(distance).not.toHaveValue("0");
  await expect(page.getByText("Adds to Box 1.")).toBeVisible();

  // Type the exact distance.
  await distance.fill("5");
  await distance.press("Enter");
  await expect(page.getByText("Pulled a face of Box 1 out 5 mm")).toBeVisible();
  await expect(page.getByRole("button", { name: /Push\/pull 1/ }).first()).toBeVisible();
  await page.getByRole("treeitem", { name: /Box 1/ }).click();
  await expect(page.getByText("10,000 mm³")).toBeVisible({ timeout: 20_000 });

  // One undo takes it back.
  await page.keyboard.press("Control+z");
  await expect(page.getByText("8,000 mm³")).toBeVisible({ timeout: 20_000 });
});
