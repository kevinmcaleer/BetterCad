import { expect, test, type Page } from "@playwright/test";

async function addShape(page: Page, name: string) {
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name, exact: true }).click();
}

const canvas = (page: Page) => page.getByTestId("view-canvas");

test("the 3D view draws and a click on a part selects it", async ({ page }) => {
  await page.goto("/");
  await addShape(page, "Box");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("treeitem", { name: /Box 1/ })).toHaveAttribute("aria-selected", "false");
  const box = (await canvas(page).boundingBox())!;
  // The first part is framed, so the middle of the view is on it.
  await page.waitForTimeout(500);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("treeitem", { name: /Box 1/ })).toHaveAttribute("aria-selected", "true");
  // A click on empty space clears it.
  await page.mouse.click(box.x + 20, box.y + box.height - 20);
  await expect(page.getByRole("treeitem", { name: /Box 1/ })).toHaveAttribute("aria-selected", "false");
});

test("presets, orbit and the pick filter", async ({ page }) => {
  await page.goto("/");
  await addShape(page, "Box");
  await page.getByRole("application", { name: /3D view/ }).focus();
  // The view cube has the standard views; the view bar does not.
  const bar = page.getByRole("toolbar", { name: "View tools" });
  for (const name of ["Front", "Side", "Top"]) await expect(bar.getByRole("button", { name, exact: true })).toHaveCount(0);
  await page.keyboard.press("2");
  await expect(page.getByRole("application", { name: /3D view/ })).toHaveAttribute("data-view", "front");
  // Arrow keys turn the view, so it is no longer a preset.
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("application", { name: /3D view/ })).not.toHaveAttribute("data-view", "front");
  await page.keyboard.press("3");
  await expect(page.getByRole("application", { name: /3D view/ })).toHaveAttribute("data-view", "side");
  // Home is the corner view, not a side view.
  await page.keyboard.press("Home");
  await expect(page.getByRole("application", { name: /3D view/ })).not.toHaveAttribute("data-view", "side");

  await page.keyboard.press("Shift+2");
  await expect(page.getByRole("button", { name: /Pick: Faces/ })).toBeVisible();
  await page.waitForTimeout(400);
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(".bc-help")).toContainText(/Face \d of Box 1 picked/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".bc-help")).not.toContainText("picked");
});

test("the view cube turns the view", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Look from the top" }).click();
  await expect(page.getByRole("application", { name: /3D view/ })).toHaveAttribute("data-view", "top");
});

test("the view cube's house and menu", async ({ page }) => {
  await page.goto("/");
  await addShape(page, "Box");
  const cube = page.getByRole("group", { name: "View cube" });
  await cube.getByRole("button", { name: "Look from the top" }).click();
  await expect(page.getByRole("application", { name: /3D view/ })).toHaveAttribute("data-view", "top");
  await cube.hover();
  await cube.getByRole("button", { name: "Go home" }).click();
  await expect(page.getByRole("application", { name: /3D view/ })).not.toHaveAttribute("data-view", "top");

  // Perspective and orthographic live in the cube's menu now.
  await cube.getByRole("button", { name: "View cube options" }).click();
  await page.getByRole("menuitemradio", { name: "Orthographic" }).click();
  await cube.getByRole("button", { name: "View cube options" }).click();
  await expect(page.getByRole("menuitemradio", { name: "Orthographic" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("menuitem", { name: "Reset home" })).toBeDisabled();

  // A home of your own: look from the front, set it, go elsewhere, then home brings you back.
  await page.keyboard.press("Escape");
  await page.getByRole("application", { name: /3D view/ }).focus();
  await page.keyboard.press("2");
  await cube.getByRole("button", { name: "View cube options" }).click();
  await page.getByRole("menuitem", { name: "Set this view as home" }).click();
  await page.getByRole("application", { name: /3D view/ }).focus();
  await page.keyboard.press("4");
  await expect(page.getByRole("application", { name: /3D view/ })).toHaveAttribute("data-view", "top");
  await page.keyboard.press("Home");
  await expect(page.getByRole("application", { name: /3D view/ })).toHaveAttribute("data-view", "front");
  await cube.getByRole("button", { name: "View cube options" }).click();
  await page.getByRole("menuitem", { name: "Reset home" }).click();
  await page.keyboard.press("Home");
  await expect(page.getByRole("application", { name: /3D view/ })).not.toHaveAttribute("data-view", "front");
});

test("section: click a face, then type how far", async ({ page }) => {
  await page.goto("/");
  await addShape(page, "Box");
  await page.getByRole("application", { name: /3D view/ }).focus();
  await page.keyboard.press("x");
  await page.waitForTimeout(400);
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const offset = page.getByRole("textbox", { name: /Offset/ });
  await expect(offset).toBeVisible();
  await offset.fill("-5");
  await offset.press("Enter");
  await expect(offset).toHaveValue("-5");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByText("Click a face to cut through it.")).toBeVisible();
});

test("named views: save one and find it in the menu", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Views" }).click();
  await page.getByRole("menuitem", { name: /Save this view/ }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("Bench");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Views" }).click();
  await expect(page.getByRole("menuitemradio", { name: "Bench" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete Bench" })).toBeVisible();
});

test("move: drag the gizmo's X arrow and a Move step lands on the timeline", async ({ page }) => {
  await page.goto("/");
  await addShape(page, "Box");
  await page.getByRole("application", { name: /3D view/ }).focus();
  await page.keyboard.press("2");
  await page.keyboard.press("m");
  await page.waitForTimeout(500);
  const box = (await canvas(page).boundingBox())!;
  // In the front view the X arrow runs right from the part's origin; grab it a little way along.
  const o = await page.evaluate(() => (window as unknown as { __bcView: { project(p: number[]): { x: number; y: number } } }).__bcView.project([0, 0, 0]));
  const x0 = box.x + o.x + 45;
  const y0 = box.y + o.y;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 30, y0, { steps: 3 });
  await page.mouse.move(x0 + 90, y0, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole("textbox", { name: "X (mm)" })).not.toHaveValue("0");
});

type Bodies = { __bcView: { bodies: Map<string, { body: { world?: boolean; position: { x: number } } }> } };
const kernelBodies = (page: Page) =>
  page.evaluate(() => [...(window as unknown as Bodies).__bcView.bodies.values()].map((o) => ({ world: !!o.body.world, x: o.body.position.x })));

test("the geometry engine loads in a worker and its solids replace the quick meshes", async ({ page }) => {
  await page.goto("/");
  await addShape(page, "Cylinder");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(() => kernelBodies(page)).toEqual([{ world: true, x: 0 }]);
  // A change shows at once (the quick mesh), then the rebuilt solid lands in its new place.
  const x = page.getByRole("textbox", { name: "X (mm)" });
  await x.fill("25");
  await x.press("Enter");
  await expect.poll(() => kernelBodies(page)).toEqual([{ world: true, x: 25 }]);
});

type Orbit = { __bcView: { orbitBy(dx: number, dy: number): void; invalidate(): void; setStyle(s: string): void } };
const nextFrame = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test("the line-art outline turns with the model, not a frame behind", async ({ page }) => {
  await page.goto("/");
  await addShape(page, "Box");
  // Wait for the engine's solid: if it lands between the two shots, they differ for a reason this test isn't about.
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(() => kernelBodies(page)).toEqual([{ world: true, x: 0 }]);
  await page.evaluate(() => (window as unknown as Orbit).__bcView.setStyle("lineart"));
  // The save toast floats over the canvas and can come or go between the shots.
  await page.addStyleTag({ content: ".bc-toast { visibility: hidden !important; }" });
  await page.waitForTimeout(500);
  // One orbit step draws one frame. Drawing it again with the camera still should change nothing: a stale outline would.
  // The save toast (Autosaved) fades over the view on its own clock, so it is left out of both shots.
  const shot = { style: ".bc-toast-slot { visibility: hidden !important; }" };
  await page.evaluate(() => (window as unknown as Orbit).__bcView.orbitBy(120, 40));
  await nextFrame(page);
  const turned = await canvas(page).screenshot(shot);
  await page.evaluate(() => (window as unknown as Orbit).__bcView.invalidate());
  await nextFrame(page);
  const again = await canvas(page).screenshot(shot);
  expect(turned.equals(again)).toBe(true);
});
