import { expect, test, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number } } };

async function click(page: Page, x: number, y: number, z: number) {
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  const q = await page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  await page.mouse.move(box.x + q.x, box.y + q.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

test("an SG90 placed on a plate comes in as a reference body", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.waitForTimeout(800);

  await page.getByRole("navigation").getByRole("button", { name: "Catalogue" }).click();
  await page.getByRole("searchbox", { name: "Search parts" }).fill("sg90");
  await page.getByRole("button", { name: /SG90 micro servo/ }).click();
  await expect(page.getByText("Click a flat face, or the ground, to place the SG90 micro servo.", { exact: false }).first()).toBeVisible();
  // T turns it a quarter before it goes down; Esc would put it back.
  await page.getByRole("searchbox", { name: "Search parts" }).blur();
  await page.keyboard.press("t");
  await expect(page.getByText("Turned 90°.", { exact: false })).toBeVisible();
  await click(page, 0, 0, 20);
  await expect(page.getByText("Placed SG90 micro servo, 9 g")).toBeVisible();
  await expect(page.getByRole("button", { name: /SG90 micro servo/ }).first()).toBeVisible();

  await page.getByRole("navigation").getByRole("button", { name: "Parts" }).click();
  await expect(page.getByRole("treeitem", { name: /SG90 micro servo/ })).toBeVisible();
  await expect(page.getByText("SG90 micro servo, 9 g", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Reference", exact: true })).toBeVisible();
});

test("Esc puts a part back without placing it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Catalogue" }).click();
  await page.getByRole("button", { name: /608 bearing/ }).click();
  await expect(page.getByRole("button", { name: /608 bearing/ })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /608 bearing/ })).toHaveAttribute("aria-pressed", "false");
});
