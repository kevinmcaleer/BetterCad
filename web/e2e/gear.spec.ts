import { expect, test, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number } } };

async function click(page: Page, x: number, y: number, z: number) {
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  const q = await page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  await page.mouse.move(box.x + q.x, box.y + q.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

test("a spur gear on the ground, then 30 teeth with a D-flat bore", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.getByRole("toolbar", { name: "Model tools" }).getByRole("button", { name: /^Gear/ }).click();
  await expect(page.getByText("Click the ground or a flat face where the gear goes.").first()).toBeVisible();
  await click(page, 0, 0, 0);
  await expect(page.getByText("Pitch diameter 20 mm")).toBeVisible();

  const teeth = page.getByRole("textbox", { name: "Teeth" });
  await teeth.fill("30");
  await teeth.press("Tab");
  await expect(page.getByText("Pitch diameter 30 mm")).toBeVisible();
  await page.getByRole("button", { name: /D-flat/ }).click();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Made Gear 30T: 30 teeth, module 1")).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /Gear 30T/ }).first()).toBeVisible({ timeout: 20_000 });

  // Below 17 teeth the bar warns about undercut.
  await page
    .getByRole("region", { name: "Timeline" })
    .getByRole("button", { name: /^Gear 30T/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit gear" }).click();
  await teeth.fill("12");
  await teeth.press("Tab");
  await expect(page.getByText("Fewer than 17 teeth weakens the root at 20°. Try profile shift.")).toBeVisible();
});

test("a mating gear meshes at the centre distance and follows the first", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.getByRole("toolbar", { name: "Model tools" }).getByRole("button", { name: /^Gear/ }).click();
  await click(page, 0, 0, 0);
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^Made Gear 20T/)).toBeVisible();

  await page
    .getByRole("treeitem", { name: /Gear 20T/ })
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add mating gear" }).click();
  await expect(page.getByText("Meshes with Gear 20T, module 1. 1 : 1, both turn at the same speed.")).toBeVisible();
  const teeth = page.getByRole("textbox", { name: "Teeth" });
  await teeth.fill("40");
  await teeth.press("Tab");
  await expect(page.getByText("Meshes with Gear 20T, module 1. 2 : 1, the small gear turns twice as fast.")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^Made Gear 40T/)).toBeVisible();

  await expect(page.getByRole("region", { name: "Timeline" }).getByRole("button", { name: /^Gear 40T, 40 teeth, meshes with Gear 20T, 2 : 1/ })).toBeVisible();
});

test("two GT2 pulleys and a stock belt between them", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  const tool = page.getByRole("toolbar", { name: "Model tools" }).getByRole("button", { name: /^Gear/ });
  for (const x of [0, 40]) {
    await tool.click();
    await click(page, x, 0, 0);
    await page.getByRole("button", { name: /^GT2 pulley/ }).click();
    await expect(page.getByText("Pitch diameter 12.73 mm")).toBeVisible();
    await page.keyboard.press("Enter");
  }
  await expect(page.getByText(/^Made Pulley 20T 2: 20 teeth, GT2/)).toBeVisible();

  await page.getByRole("treeitem", { name: /Pulley 20T$/ }).click();
  await page.getByRole("treeitem", { name: /Pulley 20T 2/ }).click({ modifiers: ["Shift"] });
  await page.getByRole("treeitem", { name: /Pulley 20T 2/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Fit a belt" }).click();
  // 40 mm apart needs 120 mm of belt; the nearest stock belt is 122 mm.
  await expect(page.getByText(/^Fitted a 122 mm GT2 belt, 61 teeth \(they needed 120 mm/)).toBeVisible();
});
