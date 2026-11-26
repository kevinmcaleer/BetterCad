import { expect, test, type Page } from "@playwright/test";
import { fakeApi } from "./fakeApi";

/** Insert model (#482, #484): one of your saved models brought into another as one component. */

const SAVE = { timeout: 15_000 };
type View = { __bcView: { project(p: number[]): { x: number; y: number } } };

async function click(page: Page, x: number, y: number, z: number) {
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  const q = await page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  await page.mouse.move(box.x + q.x, box.y + q.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

test("insert a saved model from My models, place it, and joint-ready as one component", { tag: "@journey" }, async ({ page, context }) => {
  test.setTimeout(90_000);
  const server = await fakeApi(context);
  await server.signIn(context);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Kev: account and settings" })).toBeVisible();

  // A horn to insert: a cylinder saved to the account.
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Cylinder", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: /Cylinder 1/ })).toBeVisible();
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save to your account…" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Horn");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/#\/edit\/m\d+$/, SAVE);
  // Saved: Ctrl+N then starts a new model without asking first.
  await expect(page.getByRole("button", { name: "File", exact: true })).toHaveAccessibleDescription("Saved to your account", SAVE);

  // A new model with a box, then the horn inserted on the ground beside it.
  await page.keyboard.press("ControlOrMeta+n");
  await expect(page.getByRole("treeitem", { name: /Cylinder 1/ })).toHaveCount(0);
  if (!(await page.getByRole("button", { name: "Box", exact: true }).isVisible())) await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.keyboard.press("Shift+I");
  const dialog = page.getByRole("dialog", { name: "Insert model" });
  await expect(dialog.getByRole("button", { name: "Insert Horn" })).toBeVisible();
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(".png", "-picker.png") });
  await dialog.getByRole("button", { name: "Insert Horn" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Click a flat face, or the ground, to place the Horn.", { exact: false }).first()).toBeVisible();
  await click(page, -25, 0, 0);
  await expect(page.getByText("Inserted Horn as a component.", { exact: false })).toBeVisible();

  // One component named after the model, holding the horn's body, and one step on the timeline.
  await expect(page.getByRole("treeitem", { name: /Horn/ })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /Cylinder 1/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Horn/ }).first()).toBeVisible();
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });

  // Right-click the component in the browser to remove it, and undo brings it back.
  const browser = page.getByRole("tree", { name: "Browser" });
  await browser.getByText("Horn", { exact: true }).first().click({ button: "right" });
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(".png", "-remove.png") });
  await page.getByRole("menuitem", { name: "Remove Horn" }).click();
  await expect(page.getByText("Removed Horn.", { exact: false }).first()).toBeVisible();
  await expect(browser.getByText("Horn", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: /Cylinder 1/ })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("treeitem", { name: /Cylinder 1/ })).toBeVisible();
});

test("the My models panel lists saved models and right-click inserts one", async ({ page, context }) => {
  test.setTimeout(90_000);
  const server = await fakeApi(context);
  await server.signIn(context);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Kev: account and settings" })).toBeVisible();

  // Save a cylinder as Horn, then start a new model.
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Cylinder", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: /Cylinder 1/ })).toBeVisible();
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save to your account…" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Horn");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/#\/edit\/m\d+$/, SAVE);
  // Saved: Ctrl+N then starts a new model without asking first.
  await expect(page.getByRole("button", { name: "File", exact: true })).toHaveAccessibleDescription("Saved to your account", SAVE);
  await page.keyboard.press("ControlOrMeta+n");
  await expect(page.getByRole("treeitem", { name: /Cylinder 1/ })).toHaveCount(0);

  // Folded by default, it takes no room: the browser keeps the left edge, and the top bar's folder button opens it.
  const panel = page.getByRole("complementary", { name: "My models" });
  await expect(panel).toHaveCount(0);
  const browserLeft = async () => (await page.locator("#bc-left-panel").boundingBox())!.x;
  await expect.poll(browserLeft).toBeLessThan(20);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(".png", "-tab.png") });
  await page.getByRole("banner").getByRole("button", { name: "My models" }).click();
  await expect.poll(browserLeft).toBeGreaterThan(200);
  const tree = panel.getByRole("tree", { name: "Your models" });
  await expect(tree.getByRole("button", { name: "Horn" })).toBeVisible();
  // The list can still be settling as the panel opens, so right-click again until the menu shows.
  const insertItem = page.getByRole("menuitem", { name: "Insert as a linked component" });
  await expect(async () => {
    await tree.getByRole("button", { name: "Horn" }).click({ button: "right" });
    await expect(insertItem).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(".png", "-menu.png") });
  await insertItem.click();
  await expect(page.getByText("Click a flat face, or the ground, to place the Horn.", { exact: false }).first()).toBeVisible();
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(".png", "-panel.png") });
  await click(page, -40, -40, 0);
  await expect(page.getByText("Inserted Horn as a component.", { exact: false })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /Cylinder 1/ })).toBeVisible();

  // Its hide button folds it away, and the browser moves back to the left edge.
  await panel.getByRole("button", { name: "Hide my models" }).click();
  await expect(panel).toHaveCount(0);
  await expect.poll(browserLeft).toBeLessThan(20);
});

test("on a phone, the top bar's My models button opens the panel as a sheet", async ({ page, context }) => {
  const server = await fakeApi(context);
  await server.signIn(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const top = page.getByRole("banner");
  await expect(top.getByRole("button", { name: "My models" })).toBeVisible();
  await top.getByRole("button", { name: "My models" }).click();
  const panel = page.getByRole("complementary", { name: "My models" });
  await expect(panel.getByRole("searchbox", { name: "Search your models" })).toBeVisible();
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(".png", "-phone.png") });
  await top.getByRole("button", { name: "Hide my models" }).click();
  await expect(panel).toHaveCount(0);
});
