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

// The tool dialog sits above the bottom stack (status, help line, rolled-back warning, timeline), never under it.
for (const size of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`a tool dialog clears the help line and the rolled-back warning (${size.name})`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await addBox(page);
    const box = page.getByRole("button", { name: "Box", exact: true });
    if (!(await box.isVisible())) await page.getByRole("button", { name: "Library" }).click();
    await box.click();
    // On a phone the library is a sheet over the view; fold the left panel away to see the bottom stack.
    if (await box.isVisible()) {
      await page.getByRole("button", { name: "Library" }).click();
      await page.getByRole("banner").getByRole("button", { name: "Browser" }).click();
    }
    await expect(box).toBeHidden();
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(page.getByText(/^Rolled back/)).toBeVisible();
    await page.getByRole("application", { name: /3D view/ }).focus();
    await page.keyboard.press("s");
    await click(page, 0, 0, 20);
    await expect(page.getByText("1 face open on Box 1.")).toBeVisible();

    const foot = (await page.locator(".bc-stage-foot").boundingBox())!;
    const bars = page.locator(".bc-stage-bars > *");
    for (let k = 0; k < (await bars.count()); k++) {
      const bar = await bars.nth(k).boundingBox();
      if (bar) expect(bar.y + bar.height, `bar ${k} ends above the bottom stack`).toBeLessThanOrEqual(foot.y);
    }
  });
}

test("the picked edges show as a list, and reopening the step keeps them", async ({ page }) => {
  await addBox(page);
  await page.keyboard.press("g");
  await click(page, 0, -10, 20);
  await click(page, 10, 0, 20);
  await expect(page.getByText("2 edges on Box 1.")).toBeVisible();
  const list = page.getByRole("group", { name: "Picked edges" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list).toContainText("Edge 1, 20 mm");
  // The preview builds while the tool is open; screenshots for the PR are taken here.
  await page.getByRole("textbox", { name: "Radius" }).fill("4");
  await page.getByRole("textbox", { name: "Radius" }).press("Tab");
  await page.waitForTimeout(1500);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/fillet-preview.png` });
  await list.getByRole("button", { name: "Take Edge 2 out" }).click();
  await expect(page.getByText("1 edge on Box 1.")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Rounded 1 edge of Box 1, 4 mm")).toBeVisible();

  await page
    .getByRole("button", { name: /^Fillet 1/ })
    .first()
    .dblclick();
  await expect(page.getByText("Change the edges or the size on Box 1, then press Enter")).toBeVisible();
  await expect(page.getByText("1 edge on Box 1.")).toBeVisible();
  await click(page, 0, 10, 20);
  await expect(page.getByText("2 edges on Box 1.")).toBeVisible();
  await page.waitForTimeout(1500);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/fillet-reopened.png` });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Fillet 1, R 4 mm, 2 edges of Box 1/ })).toBeVisible();
});
