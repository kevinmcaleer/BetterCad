import { expect, test, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number }; preset(p: string): void } };

/** Where a world point is on the page, measured now (the stage moves when the sketch bars appear). */
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

test("draw a sized rectangle on the XY plane and finish the sketch", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);

  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Sketch/ })
    .click();
  await expect(page.getByText("Click a face or a plane to sketch on it.").first()).toBeVisible();
  await click(page, 20, 20);
  await expect(page.getByRole("toolbar", { name: "Sketch tools" })).toBeVisible();
  await expect(page.getByText("Sketching on the XY plane. Enter finishes.")).toBeVisible();
  await page.waitForTimeout(800);

  // Rectangle: one corner, then type the width, Tab, the height, Enter.
  await page.keyboard.press("r");
  await expect(page.getByRole("button", { name: /^Rectangle/, pressed: true })).toBeVisible();
  await click(page, -10, -10);
  const far = await at(page, 10, 5);
  await page.mouse.move(far.x, far.y, { steps: 3 });
  await page.getByRole("textbox", { name: "Width" }).fill("30");
  await page.keyboard.press("Tab");
  await page.getByRole("textbox", { name: "Height" }).fill("20");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: "Constraints" }).getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "30 mm", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "20 mm", exact: true })).toBeVisible();
  await expect(page.locator(".bc-help")).toContainText("2 degrees of freedom");

  // Double-click a size to change it.
  await page.getByRole("button", { name: "30 mm", exact: true }).dblclick();
  const input = page.getByRole("textbox", { name: "Size in mm" });
  await expect(input).toBeFocused();
  await input.fill("45");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "45 mm", exact: true })).toBeVisible();

  // Undo takes back one step at a time.
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: "30 mm", exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("toolbar", { name: "Model tools" })).toBeVisible();
  await expect(page.getByText("Finished Sketch 1")).toBeVisible();
  await expect(page.getByRole("button", { name: /Sketch 1/ }).first()).toBeVisible();
});

test("a sketch size uses a parameter, offered by name, and follows it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("button", { name: "Parameters", exact: true }).click();
  await page.getByRole("button", { name: "Add parameter" }).click();
  const name = page.getByRole("textbox", { name: "Name of p1" });
  await name.fill("width");
  await name.press("Enter");
  const expr = page.getByRole("textbox", { name: "Expression for width" });
  await expr.fill("20");
  await expr.press("Enter");

  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Sketch/ })
    .click();
  await click(page, 20, 20);
  await expect(page.getByRole("toolbar", { name: "Sketch tools" })).toBeVisible();
  await page.waitForTimeout(800);
  await page.keyboard.press("r");
  await click(page, -10, -10);
  const far = await at(page, 10, 5);
  await page.mouse.move(far.x, far.y, { steps: 3 });
  await page.getByRole("textbox", { name: "Width (mm)", exact: true }).fill("30");
  await page.keyboard.press("Tab");
  await page.getByRole("textbox", { name: "Height (mm)", exact: true }).fill("20");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "30 mm", exact: true })).toBeVisible();

  // Start typing a name: the parameters that fit are offered, and Enter puts one in.
  await page.getByRole("button", { name: "30 mm", exact: true }).dblclick();
  const input = page.getByRole("textbox", { name: "Size in mm" });
  await expect(input).toBeFocused();
  await input.fill("");
  await input.pressSequentially("wi");
  await expect(page.getByRole("listbox", { name: "Parameters" }).getByRole("option", { name: /width/ })).toBeVisible();
  await input.press("Enter");
  await expect(input).toHaveValue("width");
  await input.pressSequentially(" * 2");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "40 mm", exact: true })).toBeVisible();

  // Change the parameter (its panel is still open): the sketch follows.
  const again = page.getByRole("textbox", { name: "Expression for width" });
  await again.fill("25");
  await again.press("Enter");
  await expect(page.getByRole("button", { name: "50 mm", exact: true })).toBeVisible();
});

test("an open shape asks before finishing", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await page.waitForTimeout(800);
  await click(page, 0, 0);
  await click(page, 20, 0);
  await page.keyboard.press("Escape");
  await page.getByRole("toolbar", { name: "Sketch tools" }).getByRole("button", { name: "Finish sketch" }).click();
  await expect(page.getByText("This sketch has no closed shape yet, so it can't be extruded.")).toBeVisible();
  await page.getByRole("button", { name: "Finish anyway" }).click();
  await expect(page.getByRole("toolbar", { name: "Model tools" })).toBeVisible();
});

test("offset a rectangle inward, round a corner, then trim", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await page.waitForTimeout(800);
  await page.keyboard.press("r");
  await click(page, -10, -10);
  const far = await at(page, 10, 5);
  await page.mouse.move(far.x, far.y, { steps: 3 });
  await page.getByRole("textbox", { name: "Width" }).fill("40");
  await page.keyboard.press("Tab");
  await page.getByRole("textbox", { name: "Height" }).fill("20");
  await page.keyboard.press("Enter");
  const constraints = page.getByRole("list", { name: "Constraints" }).getByRole("listitem");
  await expect(constraints).toHaveCount(4);

  // Offset: click the bottom edge from just inside, so the copy goes in.
  await page.keyboard.press("o");
  await page.getByRole("textbox", { name: "Distance" }).fill("3");
  await page.keyboard.press("Enter");
  await click(page, 10, -9);
  // Four parallels join the four level and upright constraints.
  await expect(constraints).toHaveCount(8);
  await expect(page.getByRole("button", { name: "3 mm", exact: true }).first()).toBeVisible();

  // Fillet the outer bottom-left corner.
  await page.keyboard.press("f");
  await page.getByRole("textbox", { name: "Radius" }).fill("4");
  await page.keyboard.press("Enter");
  await click(page, -10, -10);
  await expect(page.getByRole("button", { name: "R 4 mm", exact: true })).toBeVisible();
  await expect(constraints.filter({ hasText: "Tangent" })).toHaveCount(2);

  // Trim: a line nothing crosses goes whole.
  await page.keyboard.press("l");
  await click(page, 30, 30);
  await click(page, 40, 30);
  await page.keyboard.press("Escape");
  await page.keyboard.press("t");
  // The new line came with a horizontal constraint, which goes with it.
  const n = await constraints.count();
  await click(page, 35, 30);
  await expect(constraints).toHaveCount(n - 1);
  await page.screenshot({ path: test.info().outputPath("edited.png") });
});

test("the origin is a snap point: a rectangle sized from it is fully constrained", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await expect(page.getByText("Sketching on the XY plane. Enter finishes.")).toBeVisible();
  await page.waitForTimeout(800);

  await page.keyboard.press("r");
  // A little off the origin still lands on it.
  const near = await at(page, 0, 0);
  await page.mouse.move(near.x + 3, near.y - 2, { steps: 3 });
  await expect(page.locator(".bc-snap-label")).toHaveText("Origin");
  await page.mouse.down();
  await page.mouse.up();
  const far = await at(page, 25, 15);
  await page.mouse.move(far.x, far.y, { steps: 3 });
  await page.getByRole("textbox", { name: "Width" }).fill("30");
  await page.keyboard.press("Tab");
  await page.getByRole("textbox", { name: "Height" }).fill("20");
  await page.keyboard.press("Enter");
  // Four from the rectangle, and the corner fixed on the origin.
  await expect(page.getByRole("list", { name: "Constraints" }).getByRole("listitem")).toHaveCount(5);
  await expect(page.locator(".bc-help")).toContainText(/fully constrained/i);
});

test("the sketch palette shows the state, hides sizes and looks at the sketch", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await page.waitForTimeout(800);
  await page.keyboard.press("r");
  await click(page, -10, -10);
  const far = await at(page, 10, 5);
  await page.mouse.move(far.x, far.y, { steps: 3 });
  await page.getByRole("textbox", { name: "Width" }).fill("30");
  await page.keyboard.press("Tab");
  await page.getByRole("textbox", { name: "Height" }).fill("20");
  await page.keyboard.press("Enter");

  const palette = page.getByRole("complementary", { name: "Sketch palette" });
  await expect(palette.getByRole("status")).toHaveText("2 degrees of freedom");
  const sizes = palette.getByRole("checkbox", { name: "Dimensions" });
  await expect(sizes).toBeChecked();
  await sizes.uncheck();
  await expect(page.getByRole("button", { name: "30 mm", exact: true })).toBeHidden();
  await sizes.check();
  await expect(page.getByRole("button", { name: "30 mm", exact: true })).toBeVisible();

  // Turned to the side, Look at brings the view square on to the sketch again.
  await page.evaluate(() => (window as unknown as View).__bcView.preset("iso"));
  await page.waitForTimeout(1200);
  await palette.getByRole("button", { name: "Look straight at the sketch" }).click();
  await page.waitForTimeout(1200);
  const a = await at(page, 0, 0);
  const b = await at(page, 10, 0);
  expect(Math.abs(a.y - b.y)).toBeLessThan(1);

  await palette.getByRole("button", { name: "Finish sketch" }).click();
  await expect(page.getByText("Finished Sketch 1")).toBeVisible();
});

test("drag a line to slide it square across, and line ends show only while drawing", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await page.waitForTimeout(800);
  // An unsized 20 × 10 rectangle.
  await page.keyboard.press("r");
  await click(page, -10, -5);
  await click(page, 10, 5);
  await page.keyboard.press("v");
  await page.screenshot({ path: test.info().outputPath("select.png") });

  // Grab the top edge and pull it up 7 mm, and sideways too: only the upward part counts.
  const from = await at(page, 0, 5);
  const to = await at(page, 4, 12);
  await page.mouse.move(from.x, from.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.screenshot({ path: test.info().outputPath("dragged.png") });

  // The right edge is now 17 mm long.
  await click(page, 30, 30);
  await page.keyboard.press("d");
  await click(page, 10, 0);
  await expect(page.getByLabel("Length 1")).toHaveValue(/^17(\.0+)?$/);
});

test("Horizontal/Vertical stays on the pointer and picks the nearer one per line", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await page.waitForTimeout(800);
  // A shallow line (about 27°) and a steep one (about 73°).
  await click(page, 0, 0);
  await click(page, 20, 10);
  await page.keyboard.press("Escape");
  await click(page, 40, 0);
  await click(page, 46, 20);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const constraints = page.getByRole("list", { name: "Constraints" }).getByRole("listitem");
  // The first line started on the origin, so its start is fixed there.
  await expect(constraints).toHaveCount(1);

  await page.getByRole("button", { name: "Constrain", exact: true }).click();
  await page.getByRole("menuitem", { name: "Horizontal/Vertical" }).click();
  await expect(page.getByRole("group", { name: "Horizontal/Vertical options" })).toBeVisible();
  await click(page, 10, 5);
  await expect(constraints.filter({ hasText: "Horizontal" })).toHaveCount(1);
  // Still armed: the next line needs only a click.
  await click(page, 43, 10);
  await expect(constraints.filter({ hasText: "Vertical" })).toHaveCount(1);
  await expect(constraints).toHaveCount(3);
  const over = await at(page, 10, 0);
  await page.mouse.move(over.x, over.y, { steps: 3 });
  await expect(page.locator(".bc-tool-tag")).toHaveText("Horizontal");
  await page.screenshot({ path: test.info().outputPath("pinned.png") });

  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Horizontal/Vertical options" })).toBeHidden();
  await expect(page.getByRole("group", { name: "Select options" })).toBeVisible();
});

test("place a point, size it from the origin, and put a line through the origin", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await page.waitForTimeout(800);
  const constraints = page.getByRole("list", { name: "Constraints" }).getByRole("listitem");

  // Point: one click, and the tool stays on for the next.
  await page.keyboard.press("p");
  await expect(page.getByRole("button", { name: /^Point/, pressed: true })).toBeVisible();
  await click(page, 15, 10);
  await expect(page.locator(".bc-help")).toContainText("2 degrees of freedom");

  // Dimension from the origin to the point.
  await page.keyboard.press("d");
  await click(page, 0, 0);
  await click(page, 15, 10);
  await expect(page.getByRole("textbox", { name: "Size in mm" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(constraints.filter({ hasText: "Fix" })).toHaveCount(1);
  await expect(page.locator(".bc-help")).toContainText("1 degree of freedom");

  // A line off the origin, then Coincident on the line and the origin.
  await page.keyboard.press("l");
  await click(page, -20, 10);
  await click(page, -5, 30);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Constrain", exact: true }).click();
  await page.getByRole("menuitem", { name: "Coincident" }).click();
  await click(page, -12.5, 20);
  await click(page, 0, 0);
  await expect(constraints.filter({ hasText: "On" })).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath("origin.png") });
  // The line now runs through the origin.
  await page.keyboard.press("Escape");
});
