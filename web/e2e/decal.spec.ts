import { expect, test, type Page } from "@playwright/test";

type View = {
  __bcView: { project(p: number[]): { x: number; y: number }; scene: { traverse(fn: (o: { userData: Record<string, unknown> }) => void): void } };
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

/** Decal meshes in the view. */
const drawn = (page: Page) =>
  page.evaluate(() => {
    let n = 0;
    (window as unknown as View).__bcView.scene.traverse((o) => {
      if (o.userData.decal) n += 1;
    });
    return n;
  });

test("put a picture on a box's top, move it, and keep it on the top when the box grows", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.waitForTimeout(800);

  await page.getByRole("toolbar", { name: "Model tools" }).getByRole("button", { name: "Decal", exact: true }).click();
  await expect(page.getByText("Click a flat face, then choose a picture to put on it.").first()).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await click(page, 0, 0, 20);
  await (await chooser).setFiles({ name: "logo.png", mimeType: "image/png", buffer: LOGO });

  // A 20 mm box's top is 20 mm across, so the picture starts 60% of that wide, in its own shape.
  const width = page.getByRole("textbox", { name: "Width" });
  await expect(width).toHaveValue("12");
  await expect(page.getByRole("textbox", { name: "Height" })).toHaveValue("6");
  await expect.poll(() => drawn(page)).toBe(1);

  // Drag it 5 mm right.
  const from = await at(page, 0, 0, 20);
  const to = await at(page, 5, 0, 20);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole("textbox", { name: "Across" })).toHaveValue("5");

  await width.fill("16");
  await width.press("Enter");
  await expect(page.getByText("Put logo.png on the face, 16 × 8 mm")).toBeVisible();
  const step = page.getByRole("button", { name: /^Decal 1,/ });
  await expect(step).toBeVisible();

  // Make the box taller: the decal rides up with the top face.
  await page.getByRole("treeitem", { name: /Box 1/ }).click();
  const height = page.getByRole("textbox", { name: "H (mm)" });
  await height.fill("35");
  await height.press("Enter");
  await expect.poll(() => drawn(page)).toBe(1);
  const top = await page.evaluate(() => {
    let z = -1;
    (window as unknown as View).__bcView.scene.traverse((o) => {
      const m = o as unknown as { userData: { decal?: string }; geometry?: { boundingSphere?: { center: { z: number } } } };
      if (m.userData.decal) z = m.geometry?.boundingSphere?.center.z ?? -1;
    });
    return z;
  });
  expect(top).toBeCloseTo(35.02, 1);
});
