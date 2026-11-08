import { expect, test } from "@playwright/test";
import { Editor, catchSaves, savedFile } from "./pages/editor";
import { readStl, stlVolume } from "./lib/stl";

/**
 * The product as a person uses it (#107), keyboard first: sketch a 40 × 30 mm rectangle, extrude it 10 mm, sketch an
 * 8 mm circle on the top and cut it through, round the four top edges 2 mm, export a fine STL, and check the file's
 * volume against the formula.
 */
test("draw a box with a hole, fillet it, export STL, and the volume is right", { tag: "@journey" }, async ({ page }) => {
  test.setTimeout(120_000);
  await catchSaves(page);
  const ed = await new Editor(page).open();
  await ed.view.preset("top");

  // K, click the ground, R, 40 Tab 30 Enter, then Esc and Enter to finish.
  // WebKit can take the click before the Sketch tool is listening for it (#215), so wait for its help line, and click
  // again if the first click still lands too early.
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

  // E, click inside, 10 Enter.
  await page.keyboard.press("e");
  const distance = ed.field("Distance");
  await ed.view.clickUntil(0, 0, 0, distance);
  await distance.fill("10");
  await distance.press("Enter");
  await expect(ed.said("Extruded one shape 10 mm")).toBeVisible();
  await ed.kernelReady();
  await page.waitForTimeout(800);

  // K, click the top, C, the centre, 8 Enter, then finish.
  await page.keyboard.press("k");
  await ed.view.clickUntil(5, 5, 10, ed.sketchTools);
  await page.waitForTimeout(800);
  await page.keyboard.press("c");
  await ed.view.click(0, 0, 10);
  await ed.view.hover(3, 0, 10);
  await ed.field("Diameter").fill("8");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(ed.said("Finished Sketch 2")).toBeVisible();

  // E, click inside the circle, −10: pushing into the face cuts.
  await page.keyboard.press("e");
  await ed.view.clickUntil(0, 0, 10, distance);
  await distance.fill("-10");
  await distance.press("Enter");
  await expect(ed.said("Cut one shape 10 mm deep")).toBeVisible();
  await ed.kernelReady();
  await page.waitForTimeout(800);

  // G, the four top edges, 2 Enter.
  await page.keyboard.press("g");
  const four = ed.said("4 edges on Body 1.");
  await expect(async () => {
    if (!(await four.count())) {
      await page.keyboard.press("Escape");
      await page.keyboard.press("g");
      for (const [x, y] of [
        [0, -15],
        [20, 0],
        [0, 15],
        [-20, 0],
      ] as const)
        await ed.view.click(x, y, 10);
    }
    await expect(four).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await ed.field("Radius").fill("2");
  await ed.field("Radius").press("Enter");
  await ed.kernelReady();

  // Ctrl+E, Fine, Export.
  const dialog = await ed.exportDialog();
  await dialog.resolution("Fine");
  await dialog.export();
  const done = ed.said(/^Exported .*\.stl$/);
  // A fine mesh of the filleted box takes over 30 s on a runner shared with a path-traced render.
  await expect(done).toBeVisible({ timeout: 60_000 });
  const name = (await done.textContent())!.replace(/^Exported /, "");
  const volume = stlVolume(readStl(await savedFile(page, name)));

  // The box, less the bore, less what the four rounds take: each edge loses (1 − π/4)r² along its length, and the
  // two rounds at each corner overlap by r³(5/3 − π/2).
  const r = 2;
  const rounds = (1 - Math.PI / 4) * r * r * 2 * (40 + 30) - 4 * r ** 3 * (5 / 3 - Math.PI / 2);
  const want = 40 * 30 * 10 - Math.PI * 4 ** 2 * 10 - rounds;
  expect(Math.abs(volume - want) / want).toBeLessThan(0.002);
});
