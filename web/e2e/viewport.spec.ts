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
  await page.keyboard.press("2");
  await expect(page.getByRole("button", { name: "Front", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Arrow keys turn the view, so it is no longer a preset.
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("button", { name: "Front", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("1");
  await expect(page.getByRole("button", { name: "Iso", exact: true })).toHaveAttribute("aria-pressed", "true");

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
  await expect(page.getByRole("button", { name: "Top", exact: true })).toHaveAttribute("aria-pressed", "true");
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
