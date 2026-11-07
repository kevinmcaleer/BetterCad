import { expect, test, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number } } };

async function click(page: Page, x: number, y: number, z: number) {
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  const q = await page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  await page.mouse.move(box.x + q.x, box.y + q.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

test("measure a face, then the angle to the next one", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.waitForTimeout(800);

  await page.keyboard.press("i");
  await expect(page.getByText("Pick something to measure, then something else for the distance.", { exact: false }).first()).toBeVisible();
  await click(page, 2, 3, 20);
  const values = page.getByRole("definition");
  await expect(values.first()).toHaveText("400 mm²");
  await click(page, 3, -10, 8);
  await expect(page.getByText("Angle")).toBeVisible();
  await expect(values.nth(1)).toHaveText("90°");
  await expect(values.first()).toHaveText("0 mm");

  // Esc puts the tool down and the measurement goes with it.
  await page.keyboard.press("Escape");
  await expect(page.getByText("Angle")).toHaveCount(0);
});
