import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/**
 * Regions as in Fusion: sketch curves are cut where they cross or touch, and a face's own edges bound regions, so the
 * corners between a circle and the face it sits on can be picked on their own.
 */
test("the corners outside a circle on a face can be cut away to round the end", async ({ page }) => {
  test.setTimeout(120_000);
  const ed = await new Editor(page).open();
  await ed.view.preset("top");

  // A 40 × 30 × 10 mm block centred on the origin.
  await page.keyboard.press("k");
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

  // On the top, a 30 mm circle touching the top, bottom and right edges.
  await page.keyboard.press("k");
  await ed.view.clickUntil(-10, 5, 10, ed.sketchTools);
  await page.waitForTimeout(800);
  await page.keyboard.press("c");
  await ed.view.click(5, 0, 10);
  await ed.view.hover(8, 0, 10);
  await ed.field("Diameter").fill("30");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(ed.said("Finished Sketch 2")).toBeVisible();
  await page.waitForTimeout(800);

  // Both corners outside the circle, cut through.
  await page.keyboard.press("e");
  const ops = page.getByRole("group", { name: "Operation" });
  await ed.view.clickUntil(19, 14, 10, ops.getByRole("button", { name: "Join", pressed: true }));
  await ed.view.click(19, -14, 10);
  await ops.getByRole("button", { name: "Cut" }).click();
  const bar = page.getByRole("group", { name: "Extrude options" });
  await bar.getByRole("button", { name: /^Distance/ }).click();
  await page.getByRole("menuitemradio", { name: "Through all" }).click();
  // Down into the block, not up off its top.
  await page.getByRole("button", { name: "Flip", exact: true }).click();
  await page.screenshot({ path: test.info().outputPath("corners-picked.png") });
  await bar.getByRole("button", { name: /^OK/ }).click();
  await expect(page.getByText("Cut 2 shapes through all")).toBeVisible();

  // 40 × 30 × 10 less the two corners: 7,500 + 1,125π mm³.
  await page.getByRole("treeitem", { name: /Body 1/ }).click();
  await expect(page.getByText("11,034.3 mm³")).toBeVisible({ timeout: 20_000 });
  await ed.view.preset("iso");
  await page.waitForTimeout(600);
  await page.screenshot({ path: test.info().outputPath("corners-cut.png") });
});
