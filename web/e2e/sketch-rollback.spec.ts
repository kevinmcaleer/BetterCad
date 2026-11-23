import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/**
 * Editing a sketch rolls the model back to just after it, as in Fusion: the body extruded from it hides, so its edges
 * can't be projected into the sketch it comes from, and it comes back, rebuilt, when the sketch finishes.
 */
test("editing an earlier sketch hides the steps after it until it finishes", async ({ page }) => {
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
  await page.keyboard.press("e");
  const distance = ed.field("Distance");
  await ed.view.clickUntil(0, 0, 0, distance);
  await distance.press("Enter");
  await expect(ed.said("Extruded one shape 10 mm")).toBeVisible();
  const body = page.getByRole("treeitem", { name: /Body 1/ });
  await expect(body).toBeVisible();

  const timeline = page.getByRole("region", { name: "Timeline" });
  await timeline.getByRole("button", { name: /^Sketch 1/ }).dblclick();
  await expect(page.getByText("Editing Sketch 1. Enter finishes.").first()).toBeVisible();
  await expect(body).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("toolbar", { name: "Sketch tools" })).toHaveCount(0);
  await expect(body).toBeVisible();
  await expect(timeline.getByRole("slider", { name: "Timeline marker" })).toHaveAttribute("aria-valuenow", "2");
});
