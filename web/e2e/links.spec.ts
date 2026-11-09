import { expect, test, type Page } from "@playwright/test";
import { bodyRows } from "./pages/editor";

/** Components (#171): two bodies made one component, kept as separate bodies, inside it in the browser. */
test("make a component of two boxes and select it from the browser", async ({ page }) => {
  await page.goto("/");
  for (const shape of ["Box", "Box", "Cylinder"]) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: shape, exact: true }).click();
  }
  await expect(bodyRows(page)).toHaveCount(3);

  await page.getByRole("treeitem", { name: /^Box 1/ }).click();
  await page.getByRole("treeitem", { name: /^Box 2/ }).click({ modifiers: ["ControlOrMeta"] });
  await page.getByRole("treeitem", { name: /^Box 2/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /New component/ }).click();
  await expect(page.getByText("Made Component 1 of 2 bodies")).toBeVisible();

  // Still three bodies; the boxes sit inside the component.
  await expect(bodyRows(page)).toHaveCount(3);
  await expect(page.getByRole("treeitem", { name: /Component 1$/ })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /^Box 1/ })).toHaveAttribute("aria-level", "4");
  await expect(page.getByRole("treeitem", { name: /^Cylinder 1/ })).toHaveAttribute("aria-level", "3");

  // Picking the cylinder then Select component from Box 1's menu picks both boxes.
  await page.getByRole("treeitem", { name: /^Cylinder 1/ }).click();
  await page.getByRole("treeitem", { name: /^Box 1/ }).click();
  await page.getByRole("treeitem", { name: /^Box 1/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Select component/ }).click();
  await expect(page.getByRole("treeitem", { name: /^Box 2/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("treeitem", { name: /^Cylinder 1/ })).toHaveAttribute("aria-selected", "false");
});

/** Components (#171): New component on the top bar makes an empty one to work in; what you add goes into it. */
test("work in a new component, nest another inside it, then go back to the model", async ({ page }) => {
  await page.goto("/");
  const tools = page.getByRole("toolbar", { name: "Model tools" });
  await tools.getByRole("button", { name: "New component" }).click();
  await expect(page.getByRole("button", { name: "Working in Component 1" })).toBeVisible();

  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: /Component 1$/ })).toBeVisible();

  // A component made now sits inside the active one, and becomes active.
  await tools.getByRole("button", { name: "New component" }).click();
  await expect(page.getByRole("treeitem", { name: /Component 2$/ })).toHaveAttribute("aria-level", "3");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Cylinder", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: /^Cylinder 1/ })).toHaveAttribute("aria-level", "5");

  // Back to the model: the next body is the model's own.
  await page.getByRole("button", { name: /^Activate Untitled model/ }).click();
  await expect(page.getByRole("button", { name: "Working in Untitled model" })).toBeVisible();
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Sphere", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: /^Sphere 1/ })).toHaveAttribute("aria-level", "3");
});

/** Mass (#174): a component's mass and centre of mass in Properties, and a body's datasheet mass in place of the estimate. */
test("see a component's mass, and give a body its datasheet mass", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await page.getByRole("treeitem", { name: /^Box 1/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /New component/ }).click();
  await page.getByRole("treeitem", { name: /^Box 1/ }).click();

  const props = page.getByRole("complementary", { name: "Properties" });
  await expect(props.getByText(/Printed: solid walls/)).toBeVisible({ timeout: 20_000 });
  await expect(props.getByText("Centre of mass")).toBeVisible();
  const field = props.getByRole("textbox", { name: /^Datasheet mass/ });
  await field.fill("55");
  await page.keyboard.press("Enter");
  await expect(props.getByText("From its datasheet, spread evenly.")).toBeVisible({ timeout: 20_000 });
  await expect(props.getByText("about 55 g")).toHaveCount(2);
});

/** Components (#334): drag a body into a component in the browser, then back out from its menu; undo puts it back. */
test("drag a body into a component, and move it back to the model", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await page.getByRole("toolbar", { name: "Model tools" }).getByRole("button", { name: "New component" }).click();
  await page.getByRole("button", { name: "Activate Untitled model" }).click();

  const box = page.getByRole("treeitem", { name: /^Box 1/ });
  await expect(box).toHaveAttribute("aria-level", "3");
  await box.dragTo(page.getByRole("treeitem", { name: /Component 1$/ }));
  await expect(page.getByRole("treeitem", { name: /Component 1$/ })).toBeVisible();
  await expect(box).toHaveAttribute("aria-level", "4");

  await box.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to Untitled model" }).click();
  await expect(box).toHaveAttribute("aria-level", "3");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(box).toHaveAttribute("aria-level", "4");
});

type View = { __bcView: { project(p: number[]): { x: number; y: number }; preset(p: string): void } };

/** Clicks a point on the ground once the camera has stopped. */
async function clickAt(page: Page, x: number, y: number) {
  const where = () => page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, 0]);
  let q = await where();
  for (let i = 0, still = 0; i < 80 && still < 4; i++) {
    await page.waitForTimeout(50);
    const r = await where();
    still = Math.abs(r.x - q.x) < 0.5 && Math.abs(r.y - q.y) < 0.5 ? still + 1 : 0;
    q = r;
  }
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  await page.mouse.move(box.x + q.x, box.y + q.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

/** Components (#171): picking a component's row makes it active; a sketch and the body extruded from it go into it. */
test("pick a component in the browser, then sketch and extrude inside it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("toolbar", { name: "Model tools" }).getByRole("button", { name: "New component" }).click();
  await page.getByRole("button", { name: "Activate Untitled model" }).click();
  await expect(page.getByRole("button", { name: "Working in Untitled model" })).toBeVisible();

  // Picking the row is enough; it stays active after you pick something else.
  await page.getByRole("treeitem", { name: /Component 1$/ }).click();
  await expect(page.getByRole("button", { name: "Working in Component 1" })).toBeVisible();

  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await clickAt(page, 20, 20);
  await expect(page.getByRole("toolbar", { name: "Sketch tools" })).toBeVisible();
  await page.waitForTimeout(800);
  await page.keyboard.press("r");
  await clickAt(page, -10, -10);
  await clickAt(page, 10, 5);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Finished Sketch 1")).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /^Sketch 1/ })).toHaveAttribute("aria-level", "4");

  await page.keyboard.press("e");
  await expect(async () => {
    await clickAt(page, 0, -2);
    await expect(page.getByRole("textbox", { name: "Distance" })).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("treeitem", { name: /Component 1$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Working in Component 1" })).toBeVisible();
});

/** Components (#335): a component's eye hides everything inside it, as one step you can undo. */
test("hide a whole component from its eye, then show it again", async ({ page }) => {
  await page.goto("/");
  for (const shape of ["Box", "Box"]) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: shape, exact: true }).click();
  }
  await page.getByRole("treeitem", { name: /^Box 1/ }).click();
  await page.getByRole("treeitem", { name: /^Box 2/ }).click({ modifiers: ["ControlOrMeta"] });
  await page.getByRole("treeitem", { name: /^Box 2/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /New component/ }).click();

  await page.getByRole("button", { name: "Hide Component 1" }).click();
  await expect(page.getByRole("button", { name: "Show Box 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show Box 2" })).toBeVisible();
  // Its radio stays beside the eye.
  await expect(page.getByRole("button", { name: "Activate Component 1" })).toBeVisible();

  await page.getByRole("button", { name: "Show Component 1" }).click();
  await expect(page.getByRole("button", { name: "Hide Box 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide Box 2" })).toBeVisible();
});
