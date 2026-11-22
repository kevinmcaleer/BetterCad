import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

type View = { __bcView: { project(p: number[]): { x: number; y: number }; preset(p: string): void } };

async function at(page: Page, x: number, y: number) {
  // Wait for the camera to stop, so the point is where it will be.
  const where = () => page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, 0]);
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

test("right-click a sketch to export it as a DXF for a cutter", async ({ page }) => {
  // Without the save picker the file downloads.
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  await click(page, 20, 20);
  await expect(page.getByRole("toolbar", { name: "Sketch tools" })).toBeVisible();
  await page.waitForTimeout(800);
  await page.keyboard.press("r");
  await click(page, -10, -10);
  const far = await at(page, 10, 5);
  await page.mouse.move(far.x, far.y, { steps: 3 });
  await page.getByRole("textbox", { name: "Width" }).fill("30");
  await page.keyboard.press("Tab");
  await page.getByRole("textbox", { name: "Height" }).fill("20");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Finished Sketch 1")).toBeVisible();

  const timeline = page.getByRole("region", { name: "Timeline" });
  await timeline.getByRole("button", { name: /^Sketch 1/ }).click({ button: "right" });
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export as DXF" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Sketch 1.dxf");
  await expect(page.getByText("Saved Sketch 1.dxf").first()).toBeVisible();
  const text = await readFile((await file.path())!, "utf8");
  // One closed outline in millimetres.
  expect(text).toContain("$INSUNITS");
  expect(text.match(/\r\nPOLYLINE\r\n/g)).toHaveLength(1);
  expect(text.match(/\r\nVERTEX\r\n/g)).toHaveLength(4);
});
