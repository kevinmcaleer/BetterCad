import { expect, test, type Page } from "@playwright/test";
import { Editor } from "./pages/editor";

/**
 * Auto project, as in Fusion: a sketch on a face starts with the face's edges in it, and the Dimension tool can size
 * to any model edge, bringing it in when it is clicked. The sketch palette turns it off.
 */

/** A 40 × 30 × 10 mm box centred on the origin, seen from the top. */
async function box(page: Page) {
  const ed = await new Editor(page).open();
  await ed.view.preset("top");
  await page.keyboard.press("k");
  await expect(ed.said("Click a face or a plane to sketch on it.").first()).toBeVisible();
  await ed.view.clickUntil(30, 30, 0, ed.sketchTools);
  await page.waitForTimeout(800);
  await page.keyboard.press("r");
  await ed.view.click(-20, -15);
  await ed.view.hover(15, 10);
  await ed.field("Width").fill("40");
  await page.keyboard.press("Tab");
  await ed.field("Height").fill("30");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "40 mm", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(ed.said("Finished Sketch 1")).toBeVisible();
  await page.keyboard.press("e");
  const distance = ed.field("Distance");
  await ed.view.clickUntil(0, 0, 0, distance);
  await distance.fill("10");
  await distance.press("Enter");
  await expect(ed.said("Extruded one shape 10 mm")).toBeVisible();
  await ed.kernelReady();
  await page.waitForTimeout(800);
  return ed;
}

/** A circle at (x, y) on the sketch, 6 mm across; keep the centre on the 5 mm grid it snaps to. */
async function circle(ed: Editor, x: number, y: number, z: number) {
  await ed.page.keyboard.press("c");
  await ed.view.click(x, y, z);
  await ed.view.hover(x + 3, y, z);
  await ed.field("Diameter").fill("6");
  await ed.page.keyboard.press("Enter");
  await ed.page.keyboard.press("Escape");
}

test("a sketch on a face starts with its edges, and a hole sizes from one", async ({ page }) => {
  test.setTimeout(90_000);
  const ed = await box(page);
  const fixes = page.getByRole("list", { name: "Constraints" }).getByRole("listitem").filter({ hasText: "Fix" });

  await page.keyboard.press("k");
  await ed.view.clickUntil(5, 5, 10, ed.sketchTools);
  await expect(ed.said("Sketching on a face, with its edges brought in. Enter finishes.")).toBeVisible();
  // The four corners of the top, held in place.
  await expect(fixes).toHaveCount(4);
  await page.waitForTimeout(800);

  // The circle's centre to the near long edge, 10 mm.
  await circle(ed, 5, 5, 10);
  await page.keyboard.press("d");
  await ed.view.click(5, 5, 10);
  await ed.view.click(-5, -15, 10);
  await ed.view.click(10, -6, 10);
  const size = page.getByRole("textbox", { name: "Size in mm" });
  await expect(size).toBeFocused();
  await size.fill("10");
  await size.press("Enter");
  await expect(page.getByRole("button", { name: "10 mm", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("face-sized.png") });

  // Turned off in the palette, the next sketch on a face starts empty.
  await page.keyboard.press("Escape");
  await page.getByRole("checkbox", { name: "Auto project geometry" }).uncheck();
  await page.keyboard.press("Enter");
  await expect(ed.said("Finished Sketch 2")).toBeVisible();
  await page.waitForTimeout(800);
  await page.keyboard.press("k");
  await ed.view.clickUntil(-10, 8, 10, ed.sketchTools);
  await expect(ed.said("Sketching on a face. Enter finishes.")).toBeVisible();
  await expect(fixes).toHaveCount(0);
});

test("the Dimension tool sizes to a model edge, bringing it into the sketch", async ({ page }) => {
  test.setTimeout(90_000);
  const ed = await box(page);
  const fixes = page.getByRole("list", { name: "Constraints" }).getByRole("listitem").filter({ hasText: "Fix" });

  // A sketch on the ground beside the box: nothing comes in until it is used.
  await page.keyboard.press("k");
  await ed.view.clickUntil(32, 26, 0, ed.sketchTools);
  await expect(ed.said("Sketching on the XY plane. Enter finishes.")).toBeVisible();
  await page.waitForTimeout(800);
  await circle(ed, 30, 5, 0);
  await expect(fixes).toHaveCount(0);

  // The circle's centre, then the box's right-hand top edge, seen from above.
  await page.keyboard.press("d");
  await ed.view.click(30, 5, 0);
  await ed.view.click(20, 0, 10);
  await expect(fixes).toHaveCount(2);
  await ed.view.click(25, -8, 0);
  const size = page.getByRole("textbox", { name: "Size in mm" });
  await expect(size).toBeFocused();
  await size.fill("12");
  await size.press("Enter");
  await expect(page.getByRole("button", { name: "12 mm", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("edge-sized.png") });
});
