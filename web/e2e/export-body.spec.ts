import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

/** Export on a body's right-click menu: the Export dialog for just that body, named after it. */
test("right-click a body to export just it as a 3MF", async ({ page }) => {
  // Without the save picker the file downloads.
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto("/");
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: "Box", exact: true }).click();
  }
  await page.getByRole("treeitem", { name: /^Box 2/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Export/ }).click();
  const dialog = page.getByRole("dialog", { name: "Export Box 2" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "URDF" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "3MF" }).click();
  await expect(dialog.getByRole("status")).toContainText("triangles", { timeout: 30_000 });
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Box 2.3mf");
  // A 3MF is a zip: one body's mesh inside.
  const bytes = await readFile((await file.path())!);
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
});
