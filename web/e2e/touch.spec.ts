import { expect, test, type CDPSession, type Page } from "@playwright/test";

// Phones and tablets: a finger taps, holds, drags, and pinches. Real touch events go in through the DevTools
// protocol, so the view sees pointerType "touch" as it would on a device.
test.use({ hasTouch: true });

type View = { __bcView: { project(p: number[]): { x: number; y: number }; preset(p: string): void } };
type P = { x: number; y: number };

const canvas = (page: Page) => page.getByTestId("view-canvas");

async function fingers(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", points: P[]) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })) });
}

/** The middle of the view, where the first part is framed. */
async function middle(page: Page): Promise<P> {
  const box = (await canvas(page).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function addBox(page: Page) {
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}

test("a tap selects a part and a tap on empty space clears it", async ({ page }) => {
  await page.goto("/");
  await addBox(page);
  const row = page.getByRole("treeitem", { name: /Box 1/ });
  await expect(row).toHaveAttribute("aria-selected", "false");
  const m = await middle(page);
  await page.touchscreen.tap(m.x, m.y);
  await expect(row).toHaveAttribute("aria-selected", "true");
  const box = (await canvas(page).boundingBox())!;
  await page.touchscreen.tap(box.x + 30, box.y + box.height - 120);
  await expect(row).toHaveAttribute("aria-selected", "false");
});

test("press and hold on a part opens its menu", async ({ page }) => {
  await page.goto("/");
  await addBox(page);
  const cdp = await page.context().newCDPSession(page);
  const m = await middle(page);
  await fingers(cdp, "touchStart", [m]);
  await page.waitForTimeout(800);
  const menu = page.getByRole("menu", { name: "Part actions" });
  await expect(menu).toBeVisible();
  await fingers(cdp, "touchEnd", []);
  await expect(menu.getByRole("menuitem", { name: /Duplicate/ })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /Box 1/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});

test("a right click on a part without a drag opens the same menu", async ({ page }) => {
  await page.goto("/");
  await addBox(page);
  const m = await middle(page);
  await page.mouse.click(m.x, m.y, { button: "right" });
  await expect(page.getByRole("menu", { name: "Part actions" })).toBeVisible();
});

test("one finger turns the view, two fingers pan and pinch", async ({ page }) => {
  await page.goto("/");
  await addBox(page);
  await page.evaluate(() => (window as unknown as View).__bcView.preset("front"));
  await page.waitForTimeout(800);
  const view = page.getByRole("application", { name: /3D view/ });
  await expect(view).toHaveAttribute("data-view", "front");
  const cdp = await page.context().newCDPSession(page);
  const where = () => page.evaluate(() => (window as unknown as View).__bcView.project([0, 0, 0]));

  // Two fingers moving apart zoom in without turning: the view stays a front view.
  const m = await middle(page);
  const before = await where();
  await fingers(cdp, "touchStart", [
    { x: m.x - 40, y: m.y },
    { x: m.x + 40, y: m.y },
  ]);
  for (let i = 1; i <= 5; i++) {
    await fingers(cdp, "touchMove", [
      { x: m.x - 40 - i * 15, y: m.y + i * 10 },
      { x: m.x + 40 + i * 15, y: m.y + i * 10 },
    ]);
  }
  await fingers(cdp, "touchEnd", []);
  await expect(view).toHaveAttribute("data-view", "front");
  const after = await where();
  // The pan moved the origin down the screen.
  expect(after.y - before.y).toBeGreaterThan(10);
  await expect(page.getByRole("menu")).toHaveCount(0);

  // One finger turns it.
  await fingers(cdp, "touchStart", [m]);
  for (let i = 1; i <= 5; i++) await fingers(cdp, "touchMove", [{ x: m.x + i * 20, y: m.y }]);
  await fingers(cdp, "touchEnd", []);
  await expect(view).not.toHaveAttribute("data-view", "front");
});

test("sketch a line with taps", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  // Where a sketch point is on the page, once the camera has stopped turning to face the sketch.
  const at = async (x: number, y: number) => {
    const where = () => page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, 0]);
    let q = await where();
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(50);
      const r = await where();
      if (Math.abs(r.x - q.x) < 0.5 && Math.abs(r.y - q.y) < 0.5) break;
      q = r;
    }
    const box = (await canvas(page).boundingBox())!;
    return { x: box.x + q.x, y: box.y + q.y };
  };
  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Sketch/ })
    .tap();
  let p = await at(20, 20);
  await page.touchscreen.tap(p.x, p.y);
  await expect(page.getByRole("toolbar", { name: "Sketch tools" })).toBeVisible();
  await page.waitForTimeout(800);
  // A new sketch starts with the Line tool on.
  await expect(page.getByRole("button", { name: /^Line/, pressed: true })).toBeVisible();
  p = await at(-10, 0);
  await page.touchscreen.tap(p.x, p.y);
  p = await at(15, 0);
  await page.touchscreen.tap(p.x, p.y);
  // A horizontal line: its ends, less one for Horizontal.
  await expect(page.locator(".bc-help")).toContainText("3 degrees of freedom");
});
