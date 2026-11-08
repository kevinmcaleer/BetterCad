import { expect, test } from "@playwright/test";
import { bodyRows } from "./pages/editor";

/** Mirror and Pattern (#69): copies show as you set them, and Join makes one printable body. */
test("mirror a box, switch to a row of four, then join them into one body", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.getByText("Added a box")).toBeVisible();

  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Pattern/ })
    .click();
  await expect(page.getByRole("button", { name: "Mirror", pressed: true })).toBeVisible();
  await expect(bodyRows(page)).toHaveCount(2);
  await expect(page.getByRole("treeitem", { name: /Box 1 mirrored/ })).toBeVisible();

  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  const count = page.getByRole("textbox", { name: "Count" });
  await count.fill("4");
  await count.press("Tab");
  await expect(bodyRows(page)).toHaveCount(4);

  // Four 20 mm cubes side by side, 20 mm apart: one 80 × 20 × 20 mm bar.
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(bodyRows(page)).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Patterned 1 body, joined")).toBeVisible();
  await expect(page.getByText("32,000 mm³")).toBeVisible({ timeout: 20_000 });

  // Undo takes the whole step back.
  await page.keyboard.press("Control+z");
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Pattern 1/ })).toHaveCount(0);
});
