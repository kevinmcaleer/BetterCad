import { expect, test, type Locator, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number }; preset(p: string): void } };

async function at(page: Page, x: number, y: number, z = 0) {
  // Wait for the camera to stop, so the point is where it will be.
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

/** Clicks until the tool takes it (under load the first click can land before the view is ready). */
async function clickUntil(page: Page, x: number, y: number, shown: Locator) {
  await expect(async () => {
    if (!(await shown.count())) await click(page, x, y);
    await expect(shown).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
}

test("text in a sketch extrudes whole, letters with their holes, and can be changed later", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);

  await page.keyboard.press("k");
  await click(page, 20, 20);
  await expect(page.getByRole("toolbar", { name: "Sketch tools" })).toBeVisible();
  await page.waitForTimeout(800);

  // W, click where the text starts: the Text card opens with the last words used, ready to type over.
  await page.getByRole("toolbar", { name: "Sketch tools" }).getByRole("button", { name: /^Text/ }).click();
  const words = page.getByRole("textbox", { name: "Text", exact: true });
  await clickUntil(page, -20, -5, words);
  await expect(words).toBeFocused();
  await words.fill("BOB");
  await page.getByLabel("Font").selectOption({ label: "Archivo Black" });
  await page.getByRole("textbox", { name: "Height" }).fill("10");
  await page.getByRole("textbox", { name: "Height" }).press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Click in the view to move where the text starts." })).toBeVisible();
  await page.getByRole("button", { name: /^Add text/ }).click();
  await expect(words).toHaveCount(0);

  // The words are closed shapes, so the sketch finishes without a warning.
  await page.keyboard.press("Enter");
  await expect(page.getByText("Finished Sketch 1")).toBeVisible();

  // One click on a letter takes the whole text: three letters, the holes in B, O and B left open.
  await page.keyboard.press("e");
  const distance = page.getByRole("textbox", { name: "Distance" });
  await clickUntil(page, -16, 0, distance);
  await distance.fill("2");
  await distance.press("Enter");
  await expect(page.getByText("Extruded one shape 2 mm")).toBeVisible();
  await page.getByRole("treeitem", { name: /Body 1/ }).click();
  const volume = page.getByText(/ mm³$/).first();
  await expect(volume).toBeVisible({ timeout: 20_000 });
  const before = await volume.textContent();

  // Edit the sketch, click the text with the Text tool, change the words: the extrude follows.
  await page
    .getByRole("region", { name: "Timeline" })
    .getByRole("button", { name: /^Sketch 1/ })
    .dblclick();
  await expect(page.getByText("Editing Sketch 1. Enter finishes.").first()).toBeVisible();
  await page.waitForTimeout(800);
  await page.getByRole("toolbar", { name: "Sketch tools" }).getByRole("button", { name: /^Text/ }).click();
  await clickUntil(page, -16, 0, words);
  await expect(words).toHaveValue("BOB");
  await words.fill("BOBBY");
  await expect(page.getByRole("status").filter({ hasText: "Drag the text with Select to move it." })).toBeVisible();
  await page.getByRole("button", { name: /^Done/ }).click();
  await expect(words).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Finished Sketch 1")).toBeVisible();
  await page.getByRole("treeitem", { name: /Body 1/ }).click();
  await expect(page.getByText(/ mm³$/).first()).not.toHaveText(before!, { timeout: 20_000 });
});
