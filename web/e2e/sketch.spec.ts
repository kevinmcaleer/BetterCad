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
  await page.getByRole("dialog", { name: "Parameters" }).getByRole("button", { name: "Close (Esc)" }).click();

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
  await expect(input).toHaveValue("width * 2");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "40 mm", exact: true })).toBeVisible();

  // Change the parameter: the sketch follows.
  await page.getByRole("banner").getByRole("button", { name: "Parameters", exact: true }).click();
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
  // The size follows the pointer until a click places it.
  await click(page, 14, 3);
  await expect(page.getByLabel("Length 1")).toHaveValue(/^17(\.0+)?$/);
});

test("a point dropped on another point or a line is made coincident with it, and undo takes it back", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await page.waitForTimeout(800);
  // A 20 × 10 rectangle, and a slanted line off to the right.
  await page.keyboard.press("r");
  await click(page, -10, -5);
  await click(page, 10, 5);
  await page.keyboard.press("l");
  await click(page, 25, -10);
  await click(page, 35, 15);
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  const constraints = page.getByRole("list", { name: "Constraints" }).getByRole("listitem");
  await expect(constraints.filter({ hasText: "Coincident" })).toHaveCount(0);

  const drag = async (fx: number, fy: number, tx: number, ty: number) => {
    const from = await at(page, fx, fy);
    const to = await at(page, tx, ty);
    await page.mouse.move(from.x, from.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  };

  // The line's top end, let go just off the rectangle's corner, snaps onto it.
  await drag(35, 15, 10.3, 5.3);
  await expect(constraints.filter({ hasText: "Coincident" })).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath("dropped-on-corner.png") });

  // Undo takes back the move and the constraint together.
  await page.keyboard.press("Control+z");
  await expect(constraints.filter({ hasText: "Coincident" })).toHaveCount(0);

  // Its bottom end, let go near the rectangle's right edge, sits on it.
  await drag(25, -10, 10.3, -2.5);
  await page.screenshot({ path: test.info().outputPath("dropped-on-edge.png") });
  await expect(constraints.filter({ hasText: /^On/ })).toHaveCount(1);

  // Let go by the edge's middle, it goes in the middle instead: the on constraint gives way to a midpoint.
  await page.keyboard.press("Control+z");
  await expect(constraints.filter({ hasText: /^On/ })).toHaveCount(0);
  await drag(25, -10, 10.3, 0);
  await expect(constraints.filter({ hasText: "Midpoint" })).toHaveCount(1);
  await expect(constraints.filter({ hasText: /^On/ })).toHaveCount(0);
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

test("Horizontal/Vertical lines up two points: a point and the origin", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await page.waitForTimeout(800);
  const constraints = page.getByRole("list", { name: "Constraints" }).getByRole("listitem");
  await page.keyboard.press("p");
  await click(page, 25, 4);
  await page.keyboard.press("Escape");
  await expect(page.locator(".bc-help")).toContainText("2 degrees of freedom");

  await page.getByRole("button", { name: "Constrain", exact: true }).click();
  await page.getByRole("menuitem", { name: "Horizontal/Vertical" }).click();
  await expect(page.locator(".bc-help")).toContainText("Pick lines, or two points to line them up");
  // The first point waits for a second; the pair sits nearer level, so it goes horizontal.
  await click(page, 25, 4);
  await expect(constraints).toHaveCount(0);
  const origin = await at(page, 0, 0);
  await page.mouse.move(origin.x, origin.y, { steps: 3 });
  await expect(page.locator(".bc-tool-tag")).toHaveText("Horizontal");
  await click(page, 0, 0);
  await expect(constraints.filter({ hasText: "Horizontal" })).toHaveCount(1);
  await expect(page.locator(".bc-help")).toContainText("1 degree of freedom");
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
  // Inside the box the two points span, the size runs along the line between them.
  await click(page, 9, 3);
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
  // Off the line's middle, which Coincident would snap to.
  await click(page, -8.75, 25);
  await click(page, 0, 0);
  await expect(constraints.filter({ hasText: "On" })).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath("origin.png") });
  // The line now runs through the origin.
  await page.keyboard.press("Escape");
});

test("Coincident snaps to the origin and a midpoint, and a constraint mark doesn't get in the way", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await page.waitForTimeout(800);
  const constraints = page.getByRole("list", { name: "Constraints" }).getByRole("listitem");

  // A rectangle round the origin and a point in it.
  await page.keyboard.press("r");
  await click(page, -20, -10);
  await click(page, 20, 10);
  await page.keyboard.press("p");
  await click(page, 10, 5);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Constrain", exact: true }).click();
  await page.getByRole("menuitem", { name: "Coincident" }).click();
  // Near the top line's midpoint the pointer snaps to it; further off it lets go.
  const near = await at(page, 0.5, 9.6);
  await page.mouse.move(near.x, near.y, { steps: 3 });
  await expect(page.locator(".bc-snap-label", { hasText: "Middle" })).toBeVisible();
  const off = await at(page, 6, 3);
  await page.mouse.move(off.x, off.y, { steps: 3 });
  await expect(page.locator(".bc-snap-label", { hasText: "Middle" })).toHaveCount(0);

  // The point onto the top line's midpoint: a midpoint constraint.
  await click(page, 10, 5);
  await click(page, 0.5, 9.6);
  await expect(constraints.filter({ hasText: "Midpoint" })).toHaveCount(1);

  // Its mark sits by the line; with the tool armed a click on the mark reaches what is under it, never the mark.
  const mark = page.getByRole("button", { name: "Midpoint constraint", exact: true });
  await expect(mark).toHaveCSS("pointer-events", "none");
  await page.keyboard.press("Escape");
  await expect(mark).toHaveCSS("pointer-events", "auto");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("place a size across, up or along a slanted line by where the pointer is, then drag it", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await page.waitForTimeout(800);
  // A line at 45°, 20 mm across and 20 mm up (a new sketch starts with the Line tool on).
  await click(page, 0, 0);
  await click(page, 20, 20);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await page.keyboard.press("d");
  await click(page, 10, 10);
  const placing = page.locator(".bc-placing");
  const hover = async (x: number, y: number) => {
    const p = await at(page, x, y);
    await page.mouse.move(p.x, p.y, { steps: 3 });
  };
  // Off to the side of the line: along it.
  await hover(16, 4);
  await expect(placing).toHaveAttribute("aria-label", /^Length 28\.28 mm/);
  // Above: level, across.
  await hover(10, 30);
  await expect(placing).toHaveAttribute("aria-label", /^Across 20 mm/);
  // To the right: upright.
  await hover(32, 10);
  await expect(placing).toHaveAttribute("aria-label", /^Up 20 mm/);
  await page.screenshot({ path: test.info().outputPath("placing-up.png") });

  // Back above, and a click puts it down there, ready to type.
  await click(page, 10, 30);
  await expect(placing).toHaveCount(0);
  const input = page.getByRole("textbox", { name: "Size in mm" });
  await expect(input).toBeFocused();
  await input.press("Escape");
  await expect(page.getByLabel("Across 1")).toHaveValue(/^20(\.0+)?$/);

  // Drag its label further up: it stays where it is let go.
  const pill = page.getByRole("button", { name: "20 mm", exact: true });
  const box = (await pill.boundingBox())!;
  const to = await at(page, 10, 40);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  const after = (await pill.boundingBox())!;
  expect(Math.abs(after.x + after.width / 2 - to.x)).toBeLessThan(3);
  expect(Math.abs(after.y + after.height / 2 - to.y)).toBeLessThan(3);
  await page.screenshot({ path: test.info().outputPath("dragged-size.png") });

  // One undo puts it back.
  await page.keyboard.press("Control+z");
  const back = (await pill.boundingBox())!;
  expect(Math.abs(back.y - box.y)).toBeLessThan(3);
});

test("size the angle between two lines, on the side the pointer is, and type it", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await page.waitForTimeout(800);
  // A level line and one rising at 45°, joined at the origin.
  await click(page, 20, 0);
  await click(page, 0, 0);
  await click(page, 20, 20);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await page.keyboard.press("d");
  const hover = async (x: number, y: number) => {
    const p = await at(page, x, y);
    await page.mouse.move(p.x, p.y, { steps: 3 });
  };
  const placing = page.locator(".bc-placing");
  // The first line's length follows the pointer; picking the second line makes it an angle.
  await click(page, 10, 0);
  await expect(placing).toHaveAttribute("aria-label", /^Length 20 mm/);
  await click(page, 12, 12);
  await hover(14, 4);
  await expect(placing).toHaveAttribute("aria-label", /^Angle 45°/);
  // Over the sloping line, on the far side: the other angle.
  await hover(-6, 10);
  await expect(placing).toHaveAttribute("aria-label", /^Angle 135°/);
  await page.screenshot({ path: test.info().outputPath("angle-placing.png") });

  await click(page, -6, 10);
  const input = page.getByRole("textbox", { name: "Angle in degrees" });
  await expect(input).toBeFocused();
  await input.fill("120 deg");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "120°", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("angle-set.png") });
});

test("measure an angle from the X axis", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await page.waitForTimeout(800);
  // A line at 45°, off the axes.
  await click(page, 5, 5);
  await click(page, 25, 25);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await page.keyboard.press("d");
  const placing = page.locator(".bc-placing");
  await click(page, 15, 15);
  await expect(placing).toHaveAttribute("aria-label", /^Length/);
  // The X axis shows while the Dimension tool is on; picking it measures the angle from it.
  await click(page, 40, 0);
  const p = await at(page, 30, 8);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await expect(placing).toHaveAttribute("aria-label", /^Angle 45°/);
  await click(page, 30, 8);
  const input = page.getByRole("textbox", { name: "Angle in degrees" });
  await expect(input).toBeFocused();
  await input.fill("30");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "30°", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("angle-from-axis.png") });
});

test("finishing a sketch puts the view back in perspective", async ({ page }) => {
  await page.goto("/");
  const view = page.getByRole("application", { name: /3D view/ });
  const cube = page.getByRole("group", { name: "View cube" });
  await expect(view).toHaveAttribute("data-projection", "perspective");

  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(600);
  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Sketch/ })
    .click();
  await click(page, 20, 20);
  await expect(page.getByText("Sketching on the XY plane. Enter finishes.")).toBeVisible();
  // Sketching looks straight at the plane, orthographic, and the menu says so.
  await expect(view).toHaveAttribute("data-projection", "orthographic");
  await cube.hover();
  await cube.getByRole("button", { name: "View cube options" }).click();
  await expect(page.getByRole("menuitemradio", { name: "Orthographic" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");

  await page.getByRole("toolbar", { name: "Sketch tools" }).getByRole("button", { name: "Finish sketch" }).click();
  await expect(view).toHaveAttribute("data-projection", "perspective");
  await cube.hover();
  await cube.getByRole("button", { name: "View cube options" }).click();
  await expect(page.getByRole("menuitemradio", { name: "Perspective" })).toHaveAttribute("aria-checked", "true");

  // Picking Orthographic then Perspective switches the camera each time.
  await page.getByRole("menuitemradio", { name: "Orthographic" }).click();
  await expect(view).toHaveAttribute("data-projection", "orthographic");
  await cube.getByRole("button", { name: "View cube options" }).click();
  await page.getByRole("menuitemradio", { name: "Perspective" }).click();
  await expect(view).toHaveAttribute("data-projection", "perspective");
});
