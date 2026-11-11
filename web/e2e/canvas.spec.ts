import { expect, test, type Page } from "@playwright/test";

type View = {
  __bcView: {
    project(p: number[]): { x: number; y: number };
    preset(v: string): void;
    scene: { traverse(fn: (o: { userData: Record<string, unknown> }) => void): void };
  };
};

/** A 64 × 32 PNG, orange on the left and blue on the right. */
const LOGO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAARUlEQVR4nO3QMQ0AMAwDsEAdlDLPYFSqfJiA00k35XWXAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQcD/gAzXtcR4zfNaIAAAAAElFTkSuQmCC",
  "base64",
);

async function at(page: Page, x: number, y: number, z: number) {
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  const q = await page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  return { x: box.x + q.x, y: box.y + q.y };
}

async function click(page: Page, x: number, y: number, z: number) {
  const p = await at(page, x, y, z);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

/** Canvas meshes in the view. */
const drawn = (page: Page) =>
  page.evaluate(() => {
    let n = 0;
    (window as unknown as View).__bcView.scene.traverse((o) => {
      if (o.userData.canvas) n += 1;
    });
    return n;
  });

test("pin a picture to the XY plane, calibrate it to 40 mm and sketch over it", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  // From above, and clear of the empty model's start card in the middle of the view.
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);

  await page.getByRole("toolbar", { name: "Model tools" }).getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(page.getByText("Click a plane or a flat face, then choose a picture to trace over.").first()).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await click(page, 15, 15, 0);
  await (await chooser).setFiles({ name: "part.png", mimeType: "image/png", buffer: LOGO });
  await expect(page.getByText("Put part.png on the XY plane")).toBeVisible();

  // 100 mm on its long side, in its own shape, its middle where you clicked.
  const width = page.getByRole("textbox", { name: "Width" });
  await expect(width).toHaveValue("100");
  await expect(page.getByRole("textbox", { name: "Height" })).toHaveValue("50");
  await expect(page.getByRole("textbox", { name: "Across" })).toHaveValue("15");
  await expect.poll(() => drawn(page)).toBe(1);

  // Two spots 20 mm apart that are really 40 mm apart.
  await page.getByRole("button", { name: "Calibrate" }).click();
  await click(page, 5, 15, 0);
  await click(page, 25, 15, 0);
  const distance = page.getByRole("textbox", { name: "Distance" });
  await expect(distance).toHaveValue("20");
  await distance.fill("40");
  await distance.press("Enter");
  await expect(page.getByText("Calibrated: the two spots are 40 mm apart")).toBeVisible();
  await expect(width).toHaveValue("200");
  await expect(page.getByRole("textbox", { name: "Across" })).toHaveValue("25");

  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: /Canvas 1/ })).toBeVisible();

  // Sketch on the same plane over it: the canvas stays.
  await page.keyboard.press("k");
  await click(page, 15, 15, 0);
  await expect(page.getByRole("toolbar", { name: "Sketch tools" })).toBeVisible();
  expect(await drawn(page)).toBe(1);
});
