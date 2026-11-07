import { expect, test, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number } } };

async function click(page: Page, x: number, y: number, z: number) {
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  const q = await page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  await page.mouse.move(box.x + q.x, box.y + q.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

test("a fillet too big to make: the problem shows, and re-picking fixes it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.waitForTimeout(800);

  // A 50 mm round on a 20 mm box can't be made.
  await page.keyboard.press("g");
  await click(page, 0, -10, 20);
  const r = page.getByRole("textbox", { name: "Radius" });
  await r.fill("50");
  await r.press("Enter");
  const problems = page.getByRole("button", { name: "Rebuilt with 1 problem" });
  await expect(problems).toBeVisible({ timeout: 20_000 });

  await problems.click();
  const banner = page.getByRole("status").filter({ hasText: "Fillet 1:" });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Re-pick" }).click();
  await expect(page.getByText("Pick the edges again on Box 1, then press Enter")).toBeVisible();
  await page.waitForTimeout(800);
  await click(page, 0, -10, 20);
  const r2 = page.getByRole("textbox", { name: "Radius" });
  await r2.fill("2");
  await r2.press("Enter");
  await expect(problems).toHaveCount(0, { timeout: 20_000 });
  // Still one step, now with the new pick.
  await expect(page.getByRole("button", { name: /^Fillet 1, R 2 mm, 1 edge of Box 1/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Fillet 2/ })).toHaveCount(0);
});
