import { expect, test, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number } } };

async function click(page: Page, x: number, y: number, z: number) {
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  const q = await page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  await page.mouse.move(box.x + q.x, box.y + q.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

test("a standoff on top of a box", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.waitForTimeout(800);

  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Mount/ })
    .click();
  await expect(page.getByText("Click a flat face where the mount goes.").first()).toBeVisible();
  await click(page, 0, 0, 20);
  await expect(page.getByText("1 standoff.", { exact: false })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Made 1 standoff on Box 1")).toBeVisible();
  await expect(page.getByRole("button", { name: /Standoffs 1/ }).first()).toBeVisible();

  // 20³ plus a 6 mm wide, 6 mm post, less a 2.9 mm M2.5 clearance hole 26 mm long.
  await page.getByRole("treeitem", { name: /Box 1/ }).click();
  await expect(page.getByText("7,997.9 mm³")).toBeVisible({ timeout: 20_000 });
});
