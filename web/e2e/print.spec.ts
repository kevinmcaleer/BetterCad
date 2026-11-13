import { expect, test, type Page } from "@playwright/test";
import { Editor } from "./pages/editor";

const openPrint = async (page: Page) => {
  if (!(await page.getByLabel("Printer", { exact: true }).isVisible())) await new Editor(page).panel("Print");
  await expect(page.getByLabel("Printer", { exact: true })).toBeVisible();
};

/** The print bed, the fit check and the weight estimate (#100, #105). */

test("a box too wide for the printer is flagged, centred on the bed and weighed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });

  await openPrint(page);
  await expect(page.getByText("The model fits a Prusa Core One.")).toBeVisible();
  await page.getByLabel("Printer", { exact: true }).selectOption("bambu-a1-mini");

  // 192 mm wide: 12 mm more than an A1 Mini's bed.
  await page.getByRole("banner").getByRole("button", { name: "Browser", exact: true }).click();
  await page.getByRole("treeitem", { name: /Box 1/ }).click();
  const w = page.getByRole("textbox", { name: "W (mm)", exact: true });
  await w.fill("192");
  await w.press("Enter");
  await openPrint(page);
  await expect(page.getByText("The model is 12 mm too wide for a Bambu A1 Mini. Rotate it or pick a bigger printer.")).toBeVisible({ timeout: 20_000 });

  // The export dialog says so too.
  await page.keyboard.press("ControlOrMeta+e");
  const exp = page.getByRole("dialog", { name: "Export" });
  await expect(exp.getByText(/12 mm too wide/)).toBeVisible();
  // Closed by its Cancel button: this test is about the warning, and Escape was lost here once under CI load (#349).
  await exp.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Export" })).toBeHidden();

  // Back to 20 mm, moved off centre, then centred.
  await w.fill("20");
  await w.press("Enter");
  const x = page.getByRole("textbox", { name: "X (mm)", exact: true });
  await x.fill("50");
  await x.press("Enter");
  // The Esc above can land on the Print panel too when the runner is slow; Print opens it again if so.
  await openPrint(page);
  // Centre on bed waits for the model's box, which a slow runner may still be rebuilding after the move: click again
  // until it has centred.
  await expect(async () => {
    await page.getByRole("button", { name: "Centre on bed" }).click();
    await expect(x).toHaveValue("0", { timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  // A 20 mm cube of PLA: 8 cm³; the weight is an estimate, so it says "about".
  await expect(page.getByText("8 cm³").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/about [\d.]+ g \(PLA, 15% infill\)/)).toBeVisible();
  await page.getByLabel("Material", { exact: true }).selectOption("petg");
  await expect(page.getByText(/about [\d.]+ g \(PETG, 15% infill\)/)).toBeVisible();

  // The printer is part of the model: undo takes the material back.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByLabel("Material", { exact: true })).toHaveValue("pla");
});

test("overhangs and thin walls: one check at a time, with the areas listed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Sphere", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await openPrint(page);

  // A sphere's underside needs support.
  await page.getByRole("group", { name: "Check" }).getByRole("button", { name: "Overhangs" }).click();
  await expect(page.getByText(/^Needs support: 1 area, [\d,]+ mm²$/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("list", { name: "Areas that need support" }).getByRole("button", { name: /Show/ }).first().click();

  // A 20 mm sphere has no thin walls at 0.8 mm, but does at 25 mm.
  await page.getByRole("group", { name: "Check" }).getByRole("button", { name: "Thin walls" }).click();
  await expect(page.getByText("No walls thinner than 0.8 mm.")).toBeVisible({ timeout: 30_000 });
  const limit = page.getByRole("textbox", { name: "Thinnest (mm)" });
  await limit.fill("25");
  await limit.press("Enter");
  await expect(page.getByText(/^1 thin area, thinnest [\d.]+ mm$/)).toBeVisible({ timeout: 30_000 });

  await page.getByRole("group", { name: "Check" }).getByRole("button", { name: "Off" }).click();
  await expect(page.getByText(/thin area/)).toHaveCount(0);
});

test("orientation suggestions turn the model onto the bed in one undoable step", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Wedge", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await openPrint(page);

  const list = page.getByRole("list", { name: "Suggestions" });
  await expect(list.getByRole("button")).toHaveCount(3, { timeout: 20_000 });
  // Each says what it weighs up, in the tooltip and the name.
  const first = list.getByRole("button").first();
  await expect(first).toHaveAttribute("title", /^Contact [\d,]+ mm², overhang [\d,]+ mm², height [\d.]+ mm$/);
  await expect(first.locator("img")).toHaveCount(1);
  const other = list.getByRole("button", { name: /^Suggestion/ }).first();
  await other.click();
  await expect(page.getByText("Turned the model and laid it on the middle of the bed")).toBeVisible();
  // Rebuilt, the chosen way down is now how it lies.
  await expect(list.getByRole("button", { name: /^As it lies now/ })).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });

  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByLabel("Printer", { exact: true })).toBeVisible();

  // The weights live in Settings, Advanced.
  await new Editor(page).panel("Settings");
  await expect(page.getByRole("group", { name: "Orientation suggestions" }).getByRole("textbox", { name: "Contact", exact: true })).toHaveValue("0.4");
});
