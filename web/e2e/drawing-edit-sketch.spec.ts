import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/** Editing the model from a drawing leaves the drawing for the 3D view first, the way Finish drawing does. */
test("double-clicking a sketch while a drawing is open leaves the drawing to edit it", async ({ page }) => {
  test.setTimeout(120_000);
  const ed = await new Editor(page).open();
  await ed.view.preset("top");
  await page.keyboard.press("k");
  await ed.view.clickUntil(30, 30, 0, ed.sketchTools);
  await page.waitForTimeout(800);
  await page.keyboard.press("r");
  await ed.view.click(-20, -15);
  await ed.view.click(20, 15);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(ed.said("Finished Sketch 1")).toBeVisible();

  const openDrawing = async () => {
    await page.getByRole("button", { name: /^(Shaded|Line art)$/ }).click();
    await page.getByRole("menuitem", { name: "New drawing" }).click();
    await page.getByRole("dialog", { name: "New drawing" }).getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("region", { name: /^Drawing: / })).toBeVisible();
  };

  // From the timeline.
  await openDrawing();
  await page
    .getByRole("region", { name: "Timeline" })
    .getByRole("button", { name: /^Sketch 1/ })
    .dblclick();
  await expect(page.getByText("Editing Sketch 1. Enter finishes.").first()).toBeVisible();
  await expect(page.getByRole("region", { name: /^Drawing: / })).toHaveCount(0);
  await expect(ed.sketchTools).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(ed.sketchTools).toHaveCount(0);

  // From the timeline's right-click menu.
  await page.getByRole("treeitem", { name: /^Drawing 1/ }).dblclick();
  await expect(page.getByRole("region", { name: /^Drawing: / })).toBeVisible();
  await page
    .getByRole("region", { name: "Timeline" })
    .getByRole("button", { name: /^Sketch 1/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit sketch" }).click();
  await expect(page.getByText("Editing Sketch 1. Enter finishes.").first()).toBeVisible();
  await expect(page.getByRole("region", { name: /^Drawing: / })).toHaveCount(0);
});
