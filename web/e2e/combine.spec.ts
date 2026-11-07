import { expect, test } from "@playwright/test";
import { bodyRows } from "./pages/editor";

test("group a box with a hole cylinder, then ungroup", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Cylinder", exact: true }).click();
  await expect(page.getByText("Added a cylinder")).toBeVisible();

  // Mark the cylinder as a hole, and move it into the box.
  await page.getByRole("button", { name: "Solid" }).click();
  await expect(page.getByRole("button", { name: "Hole", pressed: true })).toBeVisible();
  const x = page.getByRole("textbox", { name: "X (mm)" });
  await x.fill("0");
  await x.press("Enter");

  // Select both and group.
  await page.getByRole("treeitem", { name: /Box 1/ }).click();
  await page.getByRole("treeitem", { name: /Cylinder 1/ }).click({ modifiers: ["Shift"] });
  await page.keyboard.press("Control+g");
  await expect(page.getByText(/Grouped 2 bodies/)).toBeVisible();
  await expect(bodyRows(page)).toHaveCount(1);
  // A 20 mm cube less a 20 mm cylinder through it: 8000 − π·10²·20.
  await expect(page.getByText("1,716.8 mm³")).toBeVisible({ timeout: 20_000 });

  await page.keyboard.press("Control+Shift+g");
  await expect(bodyRows(page)).toHaveCount(2);
});
