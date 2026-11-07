import { expect, test, type Page } from "@playwright/test";

const openPrint = async (page: Page) => {
  if (!(await page.getByLabel("Printer", { exact: true }).isVisible())) await page.getByRole("navigation").getByRole("button", { name: "Print" }).click();
  await expect(page.getByLabel("Printer", { exact: true })).toBeVisible();
};

/** The print bed, the fit check and the weight estimate (#100, #105). */

test("a box too wide for the printer is flagged, centred on the bed and weighed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });

  await openPrint(page);
  await expect(page.getByText("The model fits a Bambu A1, P1 or X1.")).toBeVisible();
  await page.getByLabel("Printer", { exact: true }).selectOption("bambu-a1-mini");

  // 192 mm wide: 12 mm more than an A1 Mini's bed.
  await page.getByRole("navigation").getByRole("button", { name: "Parts" }).click();
  await page.getByRole("treeitem", { name: /Box 1/ }).click();
  const w = page.getByRole("textbox", { name: "W (mm)", exact: true });
  await w.fill("192");
  await w.press("Enter");
  await openPrint(page);
  await expect(page.getByText("The model is 12 mm too wide for a Bambu A1 Mini. Rotate it or pick a bigger printer.")).toBeVisible({ timeout: 20_000 });

  // The export dialog says so too.
  await page.keyboard.press("ControlOrMeta+e");
  await expect(page.getByRole("dialog", { name: "Export" }).getByText(/12 mm too wide/)).toBeVisible();
  await page.keyboard.press("Escape");

  // Back to 20 mm, moved off centre, then centred.
  await w.fill("20");
  await w.press("Enter");
  const x = page.getByRole("textbox", { name: "X (mm)", exact: true });
  await x.fill("50");
  await x.press("Enter");
  await page.getByRole("button", { name: "Centre on bed" }).click();
  await expect(page.getByText("Centred the model on the bed")).toBeVisible();
  await expect(x).toHaveValue("0");

  // A 20 mm cube of PLA: 8 cm³; the weight is an estimate, so it says "about".
  await expect(page.getByText("8 cm³").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/about [\d.]+ g \(PLA, 15% infill\)/)).toBeVisible();
  await page.getByLabel("Material", { exact: true }).selectOption("petg");
  await expect(page.getByText(/about [\d.]+ g \(PETG, 15% infill\)/)).toBeVisible();

  // The printer is part of the model: undo takes the material back.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByLabel("Material", { exact: true })).toHaveValue("pla");
});
