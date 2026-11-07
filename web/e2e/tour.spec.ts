import { expect, test, type Locator, type Page } from "@playwright/test";

/** The first-run tour (#98), run end to end by doing each step. The other specs start with it marked done. */
test.use({ storageState: { cookies: [], origins: [] } });

type View = { __bcView: { project(p: number[]): { x: number; y: number } } };

async function at(page: Page, x: number, y: number, z = 0) {
  // Wait for the camera to stop, so the point is where it will be.
  const where = () => page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  let q = await where();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(50);
    const r = await where();
    if (Math.abs(r.x - q.x) < 0.5 && Math.abs(r.y - q.y) < 0.5) break;
    q = r;
  }
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  return { x: box.x + q.x, y: box.y + q.y };
}

async function click(page: Page, x: number, y: number, z = 0) {
  const p = await at(page, x, y, z);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

async function pickShape(page: Page, x: number, y: number, taken: Locator) {
  await expect(async () => {
    if (!(await taken.count())) await click(page, x, y);
    await expect(taken).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
}

const card = (page: Page) => page.getByRole("dialog", { name: /./ }).filter({ has: page.locator(".bc-tour-title") });

test("the tour runs once, from looking around to an exported STL", { tag: "@journey" }, async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.showOpenFilePicker = async () => [];
    w.showSaveFilePicker = async (o: { suggestedName: string }) => ({
      kind: "file",
      name: o.suggestedName,
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    });
  });
  await page.goto("/");
  const tour = card(page);
  await expect(tour).toHaveAccessibleName("Look around");
  await expect(tour.getByText("1 of 5")).toBeVisible();
  await expect(tour).toBeFocused();

  // 1: drag the view (at the right edge, clear of the toolbars and the welcome card).
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  await page.waitForTimeout(600);
  const x0 = box.x + box.width - 8;
  const y0 = box.y + box.height * 0.6;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 - 4, y0 - 60, { steps: 8 });
  await page.mouse.up();
  await expect(tour).toHaveAccessibleName("Sketch a rectangle");
  await expect(tour.getByText("2 of 5")).toBeVisible();

  // 2: Show me draws a 40 × 30 mm rectangle on the ground.
  await tour.getByRole("button", { name: "Show me" }).click();
  await expect(tour).toHaveAccessibleName("Extrude it 10 mm");

  // 3: E, click inside, 10, Enter.
  await page.keyboard.press("e");
  const distance = page.getByRole("textbox", { name: "Distance" });
  await pickShape(page, 0, 0, distance);
  await distance.fill("10");
  await distance.press("Enter");
  await expect(page.getByText("Extruded one shape 10 mm")).toBeVisible();
  await expect(tour).toHaveAccessibleName("Round the top edges");

  // 4: G, the four top edges, 2 mm.
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.waitForTimeout(800);
  await page.keyboard.press("g");
  await expect(async () => {
    if (!(await page.getByText("4 edges on Body 1.").count())) {
      await page.keyboard.press("Escape");
      await page.keyboard.press("g");
      for (const [x, y] of [
        [0, -15],
        [20, 0],
        [0, 15],
        [-20, 0],
      ])
        await click(page, x!, y!, 10);
    }
    await expect(page.getByText("4 edges on Body 1.")).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  const r = page.getByRole("textbox", { name: "Radius" });
  await r.fill("2");
  await r.press("Enter");
  await expect(tour).toHaveAccessibleName("Export an STL");

  // 5: export.
  await page.keyboard.press("ControlOrMeta+e");
  const dialog = page.getByRole("dialog", { name: "Export" });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByText(/Exported .*\.stl/)).toBeVisible({ timeout: 30_000 });
  await expect(tour).toHaveAccessibleName("That's a printable part. Open it in your slicer.");
  await expect(tour.getByRole("button", { name: /sample$/ })).toHaveCount(3);
  await tour.getByRole("button", { name: "Done" }).click();
  await expect(tour).toHaveCount(0);

  // Once per browser.
  await page.reload();
  await expect(page.getByTestId("view-canvas")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(card(page)).toHaveCount(0);
});

test("Esc skips the tour, Help > Take the tour runs it again, and Back goes back", async ({ page }) => {
  await page.goto("/");
  const tour = card(page);
  await expect(tour).toHaveAccessibleName("Look around");
  await page.keyboard.press("Escape");
  await expect(tour).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("Take the tour");
  await page.getByRole("option", { name: /Take the tour/ }).click();
  await expect(tour).toHaveAccessibleName("Look around");
  await tour.getByRole("button", { name: "Show me" }).click();
  await expect(tour).toHaveAccessibleName("Sketch a rectangle", { timeout: 5000 });
  await tour.getByRole("button", { name: "Back" }).click();
  await expect(tour).toHaveAccessibleName("Look around");
  await tour.getByRole("button", { name: "Skip" }).click();
  await expect(tour).toHaveCount(0);
});

test("a share link never starts the tour", async ({ page }) => {
  await page.goto("/#/view/t000000000000000000001");
  await page.waitForTimeout(800);
  await expect(card(page)).toHaveCount(0);
});
