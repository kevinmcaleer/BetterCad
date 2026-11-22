import { expect, test } from "@playwright/test";

type View = { __bcView: { goal: { roll?: number; elevation: number }; preset(p: string): void } };

const roll = (page: import("@playwright/test").Page) => page.evaluate(() => (window as unknown as View).__bcView.goal.roll ?? 0);

test("a sketch keeps the view's turn: upside down when you left it, upside down when you edit it again", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(800);
  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Sketch/ })
    .click();
  const canvas = (await page.getByTestId("view-canvas").boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width / 2 + 40, canvas.y + canvas.height / 2 - 40);
  await expect(page.getByText("Sketching on the XY plane. Enter finishes.").first()).toBeVisible();
  expect(await roll(page)).toBe(0);

  // Turn it upside down with the view cube's arrows, and finish.
  const cube = page.getByRole("group", { name: "View cube" });
  await cube.hover();
  await cube.getByRole("button", { name: "Turn clockwise 90°" }).click();
  await cube.getByRole("button", { name: "Turn clockwise 90°" }).click();
  await expect.poll(() => roll(page)).toBe(-180);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Finished Sketch 1").first()).toBeVisible();

  // Back upright from another view, then edit the sketch: it opens upside down again.
  await page.evaluate(() => (window as unknown as View).__bcView.preset("iso"));
  await expect.poll(() => roll(page)).toBe(0);
  await page
    .getByRole("region", { name: "Timeline" })
    .getByRole("button", { name: /^Sketch 1/ })
    .dblclick();
  await expect(page.getByText("Editing Sketch 1. Enter finishes.").first()).toBeVisible();
  await expect.poll(() => roll(page)).toBe(-180);
  await expect.poll(() => page.evaluate(() => (window as unknown as View).__bcView.goal.elevation)).toBe(90);

  // Turned back upright, the sketch forgets the turn.
  await cube.hover();
  await cube.getByRole("button", { name: "Turn anticlockwise 90°" }).click();
  await cube.getByRole("button", { name: "Turn anticlockwise 90°" }).click();
  await page.keyboard.press("Enter");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("iso"));
  await page
    .getByRole("region", { name: "Timeline" })
    .getByRole("button", { name: /^Sketch 1/ })
    .dblclick();
  await expect(page.getByText("Editing Sketch 1. Enter finishes.").first()).toBeVisible();
  await expect.poll(() => roll(page)).toBe(0);
});
