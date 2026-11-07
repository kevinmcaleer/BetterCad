import { expect, test, type Page } from "@playwright/test";

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

async function click(page: Page, x: number, y: number) {
  const p = await at(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

test("deleting a sketch that an extrude uses asks first, and suppress names what is missing", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
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
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Finished Sketch 1")).toBeVisible();
  await page.keyboard.press("e");
  // The pick can land before the view settles on a slow runner: click again until the shape is taken.
  const distance = page.getByRole("textbox", { name: "Distance" });
  await expect(async () => {
    if (!(await distance.count())) await click(page, 0, 0);
    await expect(distance).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  await distance.press("Enter");
  await expect(page.getByText("Extruded one shape 10 mm")).toBeVisible();

  const timeline = page.getByRole("region", { name: "Timeline" });
  // Suppress the sketch: the extrude says what it needs.
  await timeline.getByRole("button", { name: /^Sketch 1/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Suppress" }).click();
  await expect(timeline.getByRole("button", { name: /^Extrude 1.*Needs Sketch 1, which is suppressed/ })).toBeVisible();
  await page.keyboard.press("Control+z");

  // Delete it: a dialog lists the extrude, and Delete all takes both.
  await timeline.getByRole("button", { name: /^Sketch 1/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Sketch 1" });
  await expect(dialog.getByText("Sketch 1 is used by Extrude 1.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(timeline.getByRole("button", { name: /^Sketch 1/ })).toBeVisible();

  await timeline.getByRole("button", { name: /^Sketch 1/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete all 2" }).click();
  await expect(timeline.getByRole("button", { name: /^Sketch 1/ })).toHaveCount(0);
  await expect(timeline.getByRole("button", { name: /^Extrude 1/ })).toHaveCount(0);
  await expect(page.getByText("Deleted Sketch 1 and 1 more.", { exact: false })).toBeVisible();
});
