import { expect, test } from "@playwright/test";

test("a box sized by a parameter follows when the parameter changes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("button", { name: "Parameters", exact: true }).click();
  await page.getByRole("button", { name: "Add parameter" }).click();
  const name = page.getByRole("textbox", { name: "Name of p1" });
  await name.fill("width");
  await name.press("Enter");
  const expr = page.getByRole("textbox", { name: "Expression for width" });
  await expr.fill("15 * 2");
  await expr.press("Enter");
  await expect(page.getByRole("cell", { name: "Value of width" })).toHaveText("30 mm");
  // It floats over the view: the browser stays where it is.
  await expect(page.getByRole("dialog", { name: "Parameters" })).toBeVisible();
  await expect(page.getByRole("tree", { name: "Browser" })).toBeVisible();
  await page.getByRole("dialog", { name: "Parameters" }).getByRole("button", { name: "Close (Esc)" }).click();

  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  const w = page.getByRole("textbox", { name: "W (mm)" });
  await w.fill("width");
  await w.press("Enter");
  await expect(w).toHaveValue("30");
  await expect(page.getByText("12,000 mm³")).toBeVisible({ timeout: 20_000 });

  // Change the parameter: the box follows.
  await page.getByRole("banner").getByRole("button", { name: "Parameters", exact: true }).click();
  await expect(page.getByRole("button", { name: "1", exact: true })).toBeVisible();
  const again = page.getByRole("textbox", { name: "Expression for width" });
  await again.fill("40");
  await again.press("Enter");
  await expect(page.getByRole("cell", { name: "Value of width" })).toHaveText("40 mm");
  // In use, so it can't be deleted.
  await page.getByRole("button", { name: "Delete width" }).click();
  await expect(page.getByText("width is used by Resize 1, so it can't be deleted")).toBeVisible();
  // Model parameters: the step's size, with the expression it was given.
  await page
    .getByRole("dialog", { name: "Parameters" })
    .getByRole("button", { name: /Resize 1/ })
    .click();
  await expect(page.getByRole("textbox", { name: "Width of Resize 1" })).toHaveValue("width");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Parameters" })).toBeHidden();
  await page.getByRole("treeitem", { name: /Box 1/ }).click();
  await expect(page.getByText("16,000 mm³")).toBeVisible({ timeout: 20_000 });
});
