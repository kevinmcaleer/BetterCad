import { expect, test, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number } } };

async function click(page: Page, x: number, y: number, z: number) {
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  const q = await page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  await page.mouse.move(box.x + q.x, box.y + q.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

async function construct(page: Page, label: string) {
  await page.getByRole("toolbar", { name: "Model tools" }).getByRole("button", { name: "Construct" }).click();
  await page.getByRole("menuitem", { name: label }).click();
}

/** Construction planes (#265): an offset plane from the top of a box, sketched on, and a midplane between two faces. */
test("make a plane 10 mm above a box, sketch on it, and make a midplane", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.waitForTimeout(800);

  await construct(page, "Offset plane");
  await expect(page.getByText("Pick a flat face or a plane.").first()).toBeVisible();
  await click(page, 0, 0, 20);
  const distance = page.getByRole("textbox", { name: "Distance" });
  await expect(distance).toHaveValue("10");
  await distance.fill("15");
  await distance.press("Enter");
  await expect(page.getByText("Made Plane 1")).toBeVisible();
  await expect(page.getByRole("button", { name: /Plane 1/ }).first()).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /Plane 1/ })).toBeVisible();

  // Sketch on it from the browser.
  await page.getByRole("treeitem", { name: /Plane 1/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Sketch on Plane 1" }).click();
  await expect(page.getByText("Sketching on Plane 1", { exact: false })).toBeVisible();
  await page.keyboard.press("Enter");

  // A midplane between the top and front of the box, picked in the view, back at the corner view.
  await page.keyboard.press("1");
  await page.waitForTimeout(800);
  await construct(page, "Midplane");
  await click(page, 5, 5, 20);
  await expect(page.getByText("a face of Box 1").first()).toBeVisible();
  await click(page, 0, -10, 17);
  await expect(page.getByText("Made Plane 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Plane 2, Midplane: a face of Box 1 and a face of Box 1" })).toBeVisible();

  // A midplane between two construction planes, picked in the browser.
  await construct(page, "Midplane");
  await page.getByRole("treeitem", { name: /^Plane 1/ }).click();
  await expect(page.getByRole("group", { name: "Midplane options" }).getByText("Plane 1")).toBeVisible();
  await page.getByRole("treeitem", { name: /^Plane 2/ }).click();
  await expect(page.getByText("Made Plane 3")).toBeVisible();
  await expect(page.getByRole("button", { name: "Plane 3, Midplane: Plane 1 and Plane 2" })).toBeVisible();

  // And Plane 1 picked in the view, where it floats over the box and is nearer than the top face, with the XY plane.
  await construct(page, "Midplane");
  await click(page, 4, -4, 35);
  await expect(page.getByRole("group", { name: "Midplane options" }).getByText("Plane 1")).toBeVisible();
  await page.getByRole("button", { name: "Show what is in Origin" }).click();
  await page.getByRole("treeitem", { name: /^XY plane/ }).click();
  await expect(page.getByText("Made Plane 4")).toBeVisible();
  await expect(page.getByRole("button", { name: "Plane 4, Midplane: Plane 1 and the XY plane" })).toBeVisible();

  // Undo takes the last step back.
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("treeitem", { name: /Plane 4/ })).toHaveCount(0);
});

test("the Construct menu lists Fusion's planes, axes and points", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("toolbar", { name: "Model tools" }).getByRole("button", { name: "Construct" }).click();
  const items = page.getByRole("menuitem");
  await expect(items).toHaveCount(19);
  await expect(items.first()).toHaveText("Offset plane");
  await expect(items.last()).toHaveText("Point along path");
});
