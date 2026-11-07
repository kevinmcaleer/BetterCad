import { expect, test, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number } } };

async function click(page: Page, x: number, y: number, z: number) {
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  const q = await page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  await page.mouse.move(box.x + q.x, box.y + q.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

test("two M3 holes through the top of a box", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.waitForTimeout(800);

  await page.keyboard.press("h");
  await expect(page.getByText("Click a flat face where the hole goes.").first()).toBeVisible();
  await click(page, -5, -5, 20);
  await expect(page.getByRole("button", { name: "M3", exact: true })).toBeVisible();
  await expect(page.getByText("1 hole, 3.4 mm.", { exact: false })).toBeVisible();
  // The model rebuilds with the first hole; the second goes on the same face.
  await page.waitForTimeout(800);
  await click(page, 5, 5, 20);
  await expect(page.getByText("2 holes, 3.4 mm.", { exact: false })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Made 2 holes in Box 1")).toBeVisible();
  await expect(page.getByRole("button", { name: /Hole 1/ }).first()).toBeVisible();

  // 20³ less two 3.4 mm bores, 20 mm long.
  await page.getByRole("treeitem", { name: /Box 1/ }).click();
  await expect(page.getByText("7,636.8 mm³")).toBeVisible({ timeout: 20_000 });
});

test("the printer's hole offset sizes printed holes, and Update brings old ones in line", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.waitForTimeout(800);

  await page.keyboard.press("h");
  await click(page, 0, 0, 20);
  // The fit says what it comes to, and why.
  await expect(page.getByRole("button", { name: "Clearance for printing (3.4 mm)" })).toBeVisible();
  await expect(page.getByText("Printed holes come out small. M3 → 3.4 mm so a screw slides in.")).toBeVisible();
  await page.getByRole("button", { name: "Clearance for printing (3.4 mm)" }).click();
  await expect(
    page.getByRole("menuitemradio", { name: "Heat-set insert (4 mm)" }).or(page.getByRole("menuitem", { name: "Heat-set insert (4 mm)" })),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Made 1 hole in Box 1")).toBeVisible();

  // A tighter printer: the hole made at 0.4 mm is offered an update.
  await page.getByRole("navigation").getByRole("button", { name: "Print" }).click();
  const offset = page.getByRole("textbox", { name: "Hole offset (mm)" });
  await expect(offset).toHaveValue("0.4");
  await offset.fill("0.2");
  await offset.press("Enter");
  await page.getByRole("button", { name: "Update 1 hole", exact: true }).click();
  await expect(page.getByText("1 printed hole now adds 0.2 mm")).toBeVisible();
  await expect(page.getByRole("button", { name: "Update 1 hole", exact: true })).toHaveCount(0);

  // 20³ less one 3.2 mm bore.
  await page.getByRole("navigation").getByRole("button", { name: "Browser" }).click();
  await page.getByRole("treeitem", { name: /Box 1/ }).click();
  await expect(page.getByText("7,839.2 mm³")).toBeVisible({ timeout: 20_000 });
});

test("Calibrate opens the hole calibration coupon", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Print" }).click();
  await page.getByRole("button", { name: "Calibrate holes" }).click();
  await expect(page.getByText(/Opened the hole calibration sample/)).toBeVisible({ timeout: 20_000 });
});
