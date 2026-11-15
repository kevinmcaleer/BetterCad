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
  await page.getByRole("button", { name: "Share, versions and export" }).click();
  await page.getByRole("menuitem", { name: "Save to your account…" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Horn");
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  await expect(page).toHaveURL(/#\/edit\/m\d+$/, SAVE);

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
});
