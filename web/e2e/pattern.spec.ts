import { expect, test, type Page } from "@playwright/test";
import { bodyRows } from "./pages/editor";

/** Mirror and Pattern (#69): copies show as you set them, and Join makes one printable body. */
test("mirror a box, switch to a row of four, then join them into one body", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.getByText("Added a box")).toBeVisible();

  // Mirror has its own button on the top bar, before Pattern.
  const tools = page.getByRole("toolbar", { name: "Model tools" });
  await tools.getByRole("button", { name: "Mirror", exact: true }).click();
  await expect(tools.getByRole("button", { name: "Mirror", pressed: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Kind" }).getByRole("button", { name: "Mirror", pressed: true })).toBeVisible();
  await expect(bodyRows(page)).toHaveCount(2);
  await expect(page.getByRole("treeitem", { name: /Box 1 mirrored/ })).toBeVisible();

  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await expect(tools.getByRole("button", { name: "Pattern", pressed: true })).toBeVisible();
  const count = page.getByRole("textbox", { name: "Count" });
  await count.fill("4");
  await count.press("Tab");
  await expect(bodyRows(page)).toHaveCount(4);

  // Four 20 mm cubes side by side, 20 mm apart: one 80 × 20 × 20 mm bar.
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(bodyRows(page)).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Patterned 1 body, joined")).toBeVisible();
  await expect(page.getByText("32,000 mm³")).toBeVisible({ timeout: 20_000 });

  // Undo takes the whole step back.
  await page.keyboard.press("Control+z");
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Pattern 1/ })).toHaveCount(0);
});

type View = { __bcView: { project(p: number[]): { x: number; y: number } } };

async function click(page: Page, x: number, y: number, z: number) {
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  const q = await page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  await page.mouse.move(box.x + q.x, box.y + q.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

async function addBox(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.waitForTimeout(800);
}

const mirrorTool = (page: Page) => page.getByRole("toolbar", { name: "Model tools" }).getByRole("button", { name: "Mirror", exact: true }).click();

test("mirror a box across its own top face", async ({ page }) => {
  await addBox(page);
  await mirrorTool(page);
  await expect(page.getByText("Mirroring 1 body across YZ.")).toBeVisible();
  await page.getByRole("button", { name: "Face", exact: true }).click();
  await expect(page.getByText("Click a flat face, a construction plane or an origin plane.")).toBeVisible();
  await click(page, 0, 0, 20);
  await expect(page.getByText("Mirroring 1 body across a face.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Face", pressed: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Mirrored 1 body")).toBeVisible();
  await expect(bodyRows(page)).toHaveCount(2);
  await expect(page.getByRole("treeitem", { name: /Box 1 mirrored/ })).toBeVisible();
});

test("mirror a hole onto the same box", async ({ page }) => {
  await addBox(page);
  await page.keyboard.press("h");
  await click(page, 5, 5, 20);
  await expect(page.getByText("1 hole, 3.4 mm.", { exact: false })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Made 1 hole in Box 1")).toBeVisible();

  await mirrorTool(page);
  await page.getByRole("button", { name: "Features", exact: true }).click();
  await expect(bodyRows(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Choose features" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Hole 1" }).click();
  await expect(page.getByText("Mirroring 1 feature across YZ.")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Mirrored 1 feature")).toBeVisible();
  await expect(bodyRows(page)).toHaveCount(1);

  // 20³ less two 3.4 mm bores, 20 mm long: the hole and its mirror image.
  await page.getByRole("treeitem", { name: /Box 1/ }).click();
  await expect(page.getByText("7,636.8 mm³")).toBeVisible({ timeout: 20_000 });
});

test("mirror a component into a new component", async ({ page }) => {
  await page.goto("/");
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: "Box", exact: true }).click();
  }
  await page.getByRole("treeitem", { name: /^Box 1/ }).click();
  await page.getByRole("treeitem", { name: /^Box 2/ }).click({ modifiers: ["ControlOrMeta"] });
  await page.getByRole("treeitem", { name: /^Box 2/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /New component/ }).click();
  await expect(page.getByText("Made Component 1 of 2 bodies")).toBeVisible();
  await page.keyboard.press("Escape");

  await mirrorTool(page);
  await page.getByRole("button", { name: "Component", exact: true }).click();
  await page.getByRole("button", { name: "Choose component" }).click();
  await page.getByRole("menuitemradio", { name: "Component 1" }).click();
  await expect(page.getByText("Mirroring Component 1 across YZ.")).toBeVisible();
  await page.getByRole("button", { name: "XZ", exact: true }).click();
  await expect(page.getByText("Mirroring Component 1 across XZ.")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Mirrored Component 1")).toBeVisible();
  await expect(bodyRows(page)).toHaveCount(4);
  await expect(page.getByRole("treeitem", { name: /Component 1 mirrored/ })).toBeVisible();
});

test("pick the features to mirror on the timeline", async ({ page }) => {
  await addBox(page);
  await page.keyboard.press("h");
  await click(page, 5, 5, 20);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Made 1 hole in Box 1")).toBeVisible();

  await mirrorTool(page);
  await page.getByRole("button", { name: "Features", exact: true }).click();
  const timeline = page.getByRole("region", { name: "Timeline" });
  const hole = timeline.getByRole("button", { name: /^Hole 1,/ });
  await hole.click();
  await expect(hole).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Mirroring 1 feature across YZ.")).toBeVisible();
  // The bar's list follows the timeline.
  await page.getByRole("button", { name: "Hole 1", exact: true }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Hole 1" })).toBeChecked();
  await page.keyboard.press("Escape");

  // A second click takes it out again; the box itself can't be picked.
  await hole.click();
  await expect(hole).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Choose features" })).toBeVisible();
  await timeline.getByRole("button", { name: /^Box 1,/ }).click();
  await expect(page.getByRole("button", { name: "Choose features" })).toBeVisible();

  await hole.click();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Mirrored 1 feature")).toBeVisible();
});

test("pattern a hole picked on the timeline, not its body, and reopen it with its settings", async ({ page }) => {
  await addBox(page);
  await page.keyboard.press("h");
  await click(page, 5, 5, 20);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Made 1 hole in Box 1")).toBeVisible();

  // The hole picked on the timeline is what Pattern copies, not Box 1.
  const timeline = page.getByRole("region", { name: "Timeline" });
  await timeline.getByRole("button", { name: /^Hole 1,/ }).click();
  await page.getByRole("toolbar", { name: "Model tools" }).getByRole("button", { name: "Pattern", exact: true }).click();
  await expect(page.getByText("Copying 1 feature in rows.")).toBeVisible();
  await page.getByRole("button", { name: "Circle", exact: true }).click();
  await expect(page.getByText("Copying 1 feature round the Z axis.")).toBeVisible();
  const count = page.getByRole("textbox", { name: "Count" });
  await count.fill("2");
  await count.press("Enter");
  await expect(page.getByText("Patterned 1 feature")).toBeVisible();
  await expect(bodyRows(page)).toHaveCount(1);

  // 20³ less two 3.4 mm bores, 20 mm long: the hole and its copy half way round Z.
  await page.getByRole("treeitem", { name: /Box 1/ }).click();
  await expect(page.getByText("7,636.8 mm³")).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape");

  // A double-click on its tile opens it again as it was left.
  await timeline.getByRole("button", { name: /^Pattern 1,/ }).dblclick();
  await expect(page.getByRole("group", { name: "Kind" }).getByRole("button", { name: "Circle", pressed: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Count" })).toHaveValue("2");
  await expect(page.getByText("Copying 1 feature round the Z axis.")).toBeVisible();
});
