import { expect, test, type Page } from "@playwright/test";

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
  // Edges and faces are picked on the kernel's solid.
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.waitForTimeout(800);
}

test("shell a box: the top face open, a 1.2 mm wall", async ({ page }) => {
  await addBox(page);
  await page.keyboard.press("s");
  await expect(page.getByText("Click the face to leave open, usually the top.").first()).toBeVisible();
  await click(page, 0, 0, 20);
  await expect(page.getByText("1 face open on Box 1.")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Hollowed Box 1 to a 1.2 mm wall")).toBeVisible();
  await page.getByRole("treeitem", { name: /Box 1/ }).click();
  // 20³ less the 17.6 × 17.6 × 18.8 mm inside.
  await expect(page.getByText("2,176.5 mm³")).toBeVisible({ timeout: 20_000 });
});

test("round the four top edges of a box", async ({ page }) => {
  await addBox(page);
  await page.keyboard.press("g");
  for (const [x, y] of [
    [0, -10],
    [10, 0],
    [0, 10],
    [-10, 0],
  ]) {
    await click(page, x!, y!, 20);
  }
  await expect(page.getByText("4 edges on Box 1.")).toBeVisible();
  const r = page.getByRole("textbox", { name: "Radius" });
  await r.fill("2");
  await r.press("Enter");
  await expect(page.getByText("Rounded 4 edges of Box 1, 2 mm")).toBeVisible();
  await expect(page.getByRole("button", { name: /Fillet 1/ }).first()).toBeVisible();
});
