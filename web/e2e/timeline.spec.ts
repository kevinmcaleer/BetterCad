import { expect, test, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number }; preset(p: string): void } };

async function at(page: Page, x: number, y: number, z = 0) {
  // Wait for the camera to stop (finishing a sketch turns the view back), so the point is where it will be.
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

async function click(page: Page, x: number, y: number) {
  const p = await at(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

test("deleting a sketch that an extrude uses asks first, and suppress names what is missing", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await expect(page.getByRole("toolbar", { name: "Sketch tools" })).toBeVisible();
  await page.waitForTimeout(800);
  await page.keyboard.press("r");
  await click(page, -10, -10);
  const far = await at(page, 10, 5);
  await page.mouse.move(far.x, far.y, { steps: 3 });
  await page.getByRole("textbox", { name: "Width" }).fill("30");
  await page.keyboard.press("Tab");
  await page.getByRole("textbox", { name: "Height" }).fill("20");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Finished Sketch 1")).toBeVisible();
  await page.keyboard.press("e");
  // The pick can land before the view settles on a slow runner: click again until the shape is taken.
  const distance = page.getByRole("textbox", { name: "Distance" });
  await expect(async () => {
    if (!(await distance.count())) await click(page, 0, 0);
    await expect(distance).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  await distance.press("Enter");
  await expect(page.getByText("Extruded one shape 10 mm")).toBeVisible();

  const timeline = page.getByRole("region", { name: "Timeline" });
  // A double-click opens a step: the extrude's distance, then the sketch in sketch mode.
  await timeline.getByRole("button", { name: /^Extrude 1/ }).dblclick();
  await expect(distance).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(distance).toHaveCount(0);
  await timeline.getByRole("button", { name: /^Sketch 1/ }).dblclick();
  await expect(page.getByText("Editing Sketch 1. Enter finishes.").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("toolbar", { name: "Sketch tools" })).toHaveCount(0);

  // Redefine sketch plane rolls back to before the sketch to pick; Esc keeps it where it was and rolls forward again.
  const marker = timeline.getByRole("slider", { name: "Timeline marker" });
  await timeline.getByRole("button", { name: /^Sketch 1/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Redefine sketch plane" }).click();
  await expect(page.getByText("Pick a plane or a flat face for Sketch 1. Esc keeps it where it is.").first()).toBeVisible();
  await expect(marker).toHaveAttribute("aria-valuenow", "0");
  await page.keyboard.press("Escape");
  await expect(marker).toHaveAttribute("aria-valuenow", "2");

  // Suppress the sketch: the extrude says what it needs.
  await timeline.getByRole("button", { name: /^Sketch 1/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Suppress" }).click();
  await expect(timeline.getByRole("button", { name: /^Extrude 1.*Needs Sketch 1, which is suppressed/ })).toBeVisible();
  await page.keyboard.press("Control+z");

  // Delete it: a dialog lists the extrude, and Delete all takes both.
  await timeline.getByRole("button", { name: /^Sketch 1/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Sketch 1" });
  await expect(dialog.getByText("Sketch 1 is used by Extrude 1.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(timeline.getByRole("button", { name: /^Sketch 1/ })).toBeVisible();

  await timeline.getByRole("button", { name: /^Sketch 1/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete all 2" }).click();
  await expect(timeline.getByRole("button", { name: /^Sketch 1/ })).toHaveCount(0);
  await expect(timeline.getByRole("button", { name: /^Extrude 1/ })).toHaveCount(0);
  await expect(page.getByText("Deleted Sketch 1 and 1 more.", { exact: false })).toBeVisible();
});

test("the marker scrubs across several steps in one drag, and a double-click opens a step", async ({ page }) => {
  await page.goto("/");
  for (let k = 0; k < 4; k++) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: "Box", exact: true }).click();
  }
  const timeline = page.getByRole("region", { name: "Timeline" });
  const marker = timeline.getByRole("slider", { name: "Timeline marker" });
  await expect(marker).toHaveAttribute("aria-valuenow", "4");

  // One drag, from the end to before the first tile, rolls all the way back.
  const from = (await marker.boundingBox())!;
  const first = (await timeline.getByRole("button", { name: /^Box 1/ }).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x - 4, from.y + from.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(marker).toHaveAttribute("aria-valuenow", "0");

  // A double-click on a step past the marker rolls forward to it and opens it.
  await timeline.getByRole("button", { name: /^Box 3/ }).dblclick();
  await expect(marker).toHaveAttribute("aria-valuenow", "3");
  await expect(page.getByText("Change Box 3 in Properties.").first()).toBeVisible();
});

test("drags a step to a new place on the timeline, and undo puts it back", async ({ page }) => {
  await page.goto("/");
  for (const name of ["Box", "Cylinder"]) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name, exact: true }).click();
  }
  const bar = page.getByRole("region", { name: "Timeline" });
  const order = () => bar.locator(".bc-tl-tile").evaluateAll((ts) => ts.map((t) => t.getAttribute("aria-label")!.split(",")[0]));
  await expect.poll(order).toEqual(["Box 1", "Cylinder 1"]);
  const from = (await bar.getByRole("button", { name: /^Cylinder 1/ }).boundingBox())!;
  const to = (await bar.getByRole("button", { name: /^Box 1/ }).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 2, to.y + to.height / 2, { steps: 8 });
  await expect(bar.locator(".bc-tl-drop")).toBeVisible();
  await page.mouse.up();
  await expect.poll(order).toEqual(["Cylinder 1", "Box 1"]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(order).toEqual(["Box 1", "Cylinder 1"]);
});

test("Shell moves before Fillet and keeps its open top, with no warning", async ({ page }) => {
  // A 70 × 58 × 32 mm box, its four upright edges rounded, then hollowed open at the top (face 1 once filleted).
  const doc = {
    format: "bettercad",
    version: 2,
    name: "Tray",
    looks: {},
    features: [
      { id: "a", name: "Box 1", type: "add", part: { id: "t", name: "Box 1", kind: "box", position: { x: 0, y: 0, z: 0 }, size: { x: 70, y: 58, z: 32 } } },
      { id: "f", name: "Fillet 1", type: "fillet", part: "t", refs: [0, 2, 4, 6], size: 5 },
      { id: "s", name: "Shell 1", type: "shell", part: "t", refs: [1], size: 2 },
    ],
  };
  await page.addInitScript((text) => {
    const file = { kind: "file", name: "Tray.bcad", getFile: async () => new File([text], "Tray.bcad"), queryPermission: async () => "granted" };
    (window as unknown as Record<string, unknown>).showOpenFilePicker = async () => [file];
  }, JSON.stringify(doc));
  await page.goto("/");
  await expect(page).toHaveTitle("Untitled model · BetterCad");
  await page.keyboard.press("ControlOrMeta+o");
  await expect(page.getByText("Opened Tray.bcad")).toBeVisible();
  const bar = page.getByRole("region", { name: "Timeline" });
  const order = () => bar.locator(".bc-tl-tile").evaluateAll((ts) => ts.map((t) => t.getAttribute("aria-label")!.split(",")[0]));
  await expect.poll(order).toEqual(["Box 1", "Fillet 1", "Shell 1"]);

  const from = (await bar.getByRole("button", { name: /^Shell 1/ }).boundingBox())!;
  const to = (await bar.getByRole("button", { name: /^Fillet 1/ }).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText("Moved Shell 1.", { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect.poll(order).toEqual(["Box 1", "Shell 1", "Fillet 1"]);
  await expect(bar.getByRole("status")).toHaveCount(0);
  await expect(bar.getByRole("button", { name: /problem/ })).toHaveCount(0);
});

test("rolled back with many steps, the timeline stays on one row and the strip scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/");
  for (let k = 0; k < 24; k++) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: "Box", exact: true }).click();
  }
  const timeline = page.getByRole("region", { name: "Timeline" });
  const marker = timeline.getByRole("slider", { name: "Timeline marker" });
  await expect(marker).toHaveAttribute("aria-valuenow", "24");
  await timeline.getByRole("button", { name: /^Step back/ }).click();
  await expect(timeline.getByText("Step 23 of 24")).toBeVisible();
  await expect(timeline.getByRole("status")).toBeVisible();

  // Every control sits on the one row under the warning.
  const middle = async (name: RegExp) => {
    const b = (await timeline.getByRole("button", { name }).boundingBox())!;
    return b.y + b.height / 2;
  };
  const row = await middle(/^Roll back to the start/);
  expect(Math.abs((await middle(/^History/)) - row)).toBeLessThan(4);
  expect(Math.abs((await middle(/^Box 1,/)) - row)).toBeLessThan(4);
  const summary = (await timeline.getByText("Step 23 of 24").boundingBox())!;
  expect(Math.abs(summary.y + summary.height / 2 - row)).toBeLessThan(4);
  const strip = timeline.locator(".bc-tl-strip");
  expect(await strip.evaluate((s) => s.scrollWidth > s.clientWidth)).toBe(true);

  // On a phone the strip folds away and the rest still fits on one row.
  await page.setViewportSize({ width: 360, height: 700 });
  const phoneRow = await middle(/^Roll back to the start/);
  expect(Math.abs((await middle(/^History/)) - phoneRow)).toBeLessThan(4);
});
