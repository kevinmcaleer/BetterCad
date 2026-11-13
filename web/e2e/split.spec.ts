import { expect, test } from "@playwright/test";
import { Editor, bodyRows } from "./pages/editor";

/** Split body (#406): a 20 mm box split along YZ through its middle, both halves kept: two 4,000 mm³ bodies. */
test("split a box in two along a plane", async ({ page }) => {
  test.setTimeout(90_000);
  const ed = await new Editor(page).open();
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.getByText("Added a box")).toBeVisible();
  await ed.view.preset("iso");

  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Split body/ })
    .click();
  const panel = page.getByRole("group", { name: "Split body options" });
  await expect(panel.getByText("Click the body to split.")).toBeVisible();
  await ed.view.clickUntil(0, 0, 20, panel.getByRole("group", { name: "Halves to keep" }));
  // It starts along YZ through the box's middle, ready to pick another plane; the YZ button keeps that one.
  await expect(panel.getByRole("button", { name: "Face", pressed: true })).toBeVisible();
  await panel.getByRole("button", { name: "YZ" }).click();
  await expect(panel.getByRole("button", { name: "YZ", pressed: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Split Box 1")).toBeVisible();
  await expect(bodyRows(page)).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Split 1/ })).toBeVisible();

  await page.getByRole("treeitem", { name: /Box 1 \(2\)/ }).click();
  await expect(page.getByText("4,000 mm³")).toBeVisible({ timeout: 20_000 });
});
