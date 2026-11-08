import { expect, test, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number } } };

async function click(page: Page, x: number, y: number, z: number) {
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  const q = await page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  await page.mouse.move(box.x + q.x, box.y + q.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

/** Joints (#172): a box made a link, hung from Base on a hinge about its top face, then made a slider. */
test("hang a link from Base on a hinge, back out a pick with Esc, then make it a slider", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: "Box", exact: true }).click();
  }
  await page.getByRole("treeitem", { name: /^Box 2/ }).click();
  await page.getByRole("treeitem", { name: /^Box 2/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Make link/ }).click();
  await expect(page.getByText("Made Link 1 of 1 body")).toBeVisible();

  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Joint/ })
    .click();
  // A body in Base can't move on its own.
  await click(page, 0, 0, 20);
  await expect(page.getByText(/That body is in Base/)).toBeVisible();
  await click(page, 25, 0, 20);
  await expect(page.getByText("Moves: Link 1")).toBeVisible();
  // Esc backs out the pick, then pick it again.
  await page.keyboard.press("Escape");
  await expect(page.getByText("Moves: Link 1")).toHaveCount(0);
  await click(page, 25, 0, 20);
  await page.getByRole("button", { name: "Base", exact: true }).click();
  await expect(page.getByText("Hangs from: Base")).toBeVisible();
  await click(page, 25, 0, 20);

  await expect(page.getByRole("button", { name: "Hinge (revolute)", pressed: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Lower" })).toHaveValue("-90");
  await page.getByRole("button", { name: "Slider (prismatic)" }).click();
  await expect(page.getByRole("textbox", { name: "Upper" })).toHaveValue("50");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Made Joint 1: slider, Link 1 on Base")).toBeVisible();

  await expect(page.getByRole("treeitem", { name: /^Joint 1/ })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /^Link 1.*slider on Joint 1/ })).toBeVisible();
});
