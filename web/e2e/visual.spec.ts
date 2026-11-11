import { expect, test } from "@playwright/test";

/**
 * Screenshot tests, tagged @visual. Baselines are made by CI on Linux (the screenshots job commits any that are
 * missing), so fonts match. To accept a deliberate change, run the "Update screenshots" workflow.
 */
const THEMES = ["light", "dark", "holoroom"] as const;
const SIZES = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
];
const BLOCKS = ["buttons", "toolbar", "panel", "fields", "rail", "tree", "props", "menu", "dialog", "banner"];

for (const theme of THEMES) {
  for (const size of SIZES) {
    test(`editor, ${theme}, ${size.name} @visual`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.addInitScript((t) => localStorage.setItem("bettercad.theme", t), theme);
      await page.goto("/");
      await expect(page.getByRole("application", { name: /3D view/ })).toBeVisible();
      await expect(page).toHaveScreenshot(`editor-${theme}-${size.name}.png`, { maxDiffPixelRatio: 0.01 });
    });
  }
}

for (const theme of THEMES) {
  test(`gallery blocks, ${theme} @visual`, async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/#/gallery");
    await expect(page.getByRole("region", { name: "Holoroom" })).toBeVisible();
    for (const block of BLOCKS) {
      const el = page.locator(`section[data-theme="${theme}"] [data-block="${block}"]`);
      await expect(el).toHaveScreenshot(`gallery-${theme}-${block}.png`, { maxDiffPixelRatio: 0.01 });
    }
  });
}

/** A 64 × 32 PNG, orange on the left and blue on the right. */
const LOGO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAARUlEQVR4nO3QMQ0AMAwDsEAdlDLPYFSqfJiA00k35XWXAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQcD/gAzXtcR4zfNaIAAAAAElFTkSuQmCC",
  "base64",
);

for (const theme of THEMES) {
  test(`a decal on a box, ${theme} @visual`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript((t) => localStorage.setItem("bettercad.theme", t), theme);
    await page.goto("/");
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: "Box", exact: true }).click();
    await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
    await page.waitForTimeout(800);
    await page.getByRole("toolbar", { name: "Model tools" }).getByRole("button", { name: "Decal", exact: true }).click();
    const canvas = page.getByTestId("view-canvas");
    const box = (await canvas.boundingBox())!;
    const q = await page.evaluate(
      (p) => (window as unknown as { __bcView: { project(p: number[]): { x: number; y: number } } }).__bcView.project(p),
      [0, 0, 20],
    );
    const chooser = page.waitForEvent("filechooser");
    await page.mouse.move(box.x + q.x, box.y + q.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.up();
    await (await chooser).setFiles({ name: "logo.png", mimeType: "image/png", buffer: LOGO });
    await expect(page.getByRole("textbox", { name: "Width" })).toHaveValue("12");
    await page.keyboard.press("Enter");
    // Off the box, so its picked highlight doesn't cover the picture.
    await page.mouse.click(box.x + 80, box.y + box.height - 140);
    // The picture is on the GPU once its texture is bigger than the placeholder.
    await expect
      .poll(() =>
        page.evaluate(() => {
          let w = 0;
          (
            window as unknown as {
              __bcView: { scene: { traverse(fn: (o: { userData: { decal?: string }; material?: { map?: { image?: { width: number } } } }) => void): void } };
            }
          ).__bcView.scene.traverse((o) => {
            if (o.userData.decal) w = o.material?.map?.image?.width ?? 0;
          });
          return w;
        }),
      )
      .toBeGreaterThan(2);
    await page.waitForTimeout(500);
    await expect(canvas).toHaveScreenshot(`decal-${theme}.png`, { maxDiffPixelRatio: 0.01 });
  });
}
