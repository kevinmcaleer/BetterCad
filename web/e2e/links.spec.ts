import { expect, test } from "@playwright/test";
import { bodyRows } from "./pages/editor";

/** Links (#171): two bodies named as one rigid link, kept as separate bodies, shown under Robot. */
test("make a link of two boxes and select it from the robot tree", async ({ page }) => {
  await page.goto("/");
  for (const shape of ["Box", "Box", "Cylinder"]) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: shape, exact: true }).click();
  }
  await expect(bodyRows(page)).toHaveCount(3);

  await page.getByRole("treeitem", { name: /^Box 1/ }).click();
  await page.getByRole("treeitem", { name: /^Box 2/ }).click({ modifiers: ["ControlOrMeta"] });
  await page.getByRole("treeitem", { name: /^Box 2/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Make link/ }).click();
  await expect(page.getByText("Made Link 1 of 2 bodies")).toBeVisible();

  // Still three bodies; the robot tree has Base and the link.
  await expect(bodyRows(page)).toHaveCount(3);
  await expect(page.getByRole("treeitem", { name: /^Base/ })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /^Link 1/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Link 1/ }).first()).toBeVisible();

  // Picking the cylinder then Select link from Box 1's menu picks both boxes.
  await page.getByRole("treeitem", { name: /^Cylinder 1/ }).click();
  await page.getByRole("treeitem", { name: /^Box 1/ }).click();
  await page.getByRole("treeitem", { name: /^Box 1/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Select link/ }).click();
  await expect(page.getByRole("treeitem", { name: /^Box 2/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("treeitem", { name: /^Cylinder 1/ })).toHaveAttribute("aria-selected", "false");
});
