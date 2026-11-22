import { expect, test, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number }; preset(p: string): void } };

async function at(page: Page, x: number, y: number, z = 0) {
  const where = () => page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  let q = await where();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(50);
    const r = await where();
    if (Math.abs(r.x - q.x) < 0.5 && Math.abs(r.y - q.y) < 0.5) break;
    q = r;
  }
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  return { x: box.x + q.x, y: box.y + q.y };
}

async function click(page: Page, x: number, y: number) {
  const p = await at(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

/** A 30 × 20 mm rectangle from (-10, -10) to (20, 10), then the Dimension tool. */
async function rectangle(page: Page) {
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await page.waitForTimeout(800);
  await page.keyboard.press("r");
  await click(page, -10, -10);
  await click(page, 20, 10);
  await page.keyboard.press("Escape");
  await page.keyboard.press("d");
}

test("a second pick on a parallel line sizes the gap between them", async ({ page }) => {
  await rectangle(page);
  const placing = page.locator(".bc-placing");
  await click(page, 0, 10);
  await expect(placing).toHaveAttribute("aria-label", /^Length 30 mm/);
  await click(page, 5, -10);
  await expect(placing).toHaveAttribute("aria-label", /20 mm/);
  await expect(placing).not.toHaveAttribute("aria-label", /^Length/);
  await click(page, 30, 0);
  const input = page.getByRole("textbox", { name: "Size in mm" });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("20");
});

test("a second pick near a parallel line's end still sizes the gap", async ({ page }) => {
  await rectangle(page);
  const placing = page.locator(".bc-placing");
  await click(page, 0, 10);
  await expect(placing).toHaveAttribute("aria-label", /^Length 30 mm/);
  await click(page, -8.5, -10);
  await expect(placing).toHaveAttribute("aria-label", /20 mm/);
  await expect(placing).not.toHaveAttribute("aria-label", /^Length/);
});

test("a circle then a line sizes from the circle's centre to the line", async ({ page }) => {
  await rectangle(page);
  await page.keyboard.press("c");
  await click(page, 5, 0);
  await click(page, 10, 0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("d");
  const placing = page.locator(".bc-placing");
  await click(page, 5, -5);
  await expect(placing).toHaveAttribute("aria-label", /^Diameter/);
  await click(page, 0, 10);
  await expect(placing).toHaveAttribute("aria-label", /10 mm/);
  await click(page, 30, 0);
  await expect(page.getByRole("textbox", { name: "Size in mm" })).toHaveValue("10");
});

test("a line then a lone point sizes from the point to the line", async ({ page }) => {
  await rectangle(page);
  await page.keyboard.press("p");
  await click(page, 5, 5);
  await page.keyboard.press("Escape");
  await page.keyboard.press("d");
  const placing = page.locator(".bc-placing");
  await click(page, 0, 10);
  await expect(placing).toHaveAttribute("aria-label", /^Length 30 mm/);
  await click(page, 5, 5);
  await expect(placing).toHaveAttribute("aria-label", /^Distance 5 mm/);
  await click(page, 30, 0);
  await expect(page.getByRole("textbox", { name: "Size in mm" })).toHaveValue("5");
});

test("a click on the line's own end puts its length down", async ({ page }) => {
  await rectangle(page);
  const placing = page.locator(".bc-placing");
  await click(page, 0, 10);
  await expect(placing).toHaveAttribute("aria-label", /^Length 30 mm/);
  await click(page, 20, 10);
  await expect(page.getByRole("textbox", { name: "Size in mm" })).toHaveValue("30");
});
