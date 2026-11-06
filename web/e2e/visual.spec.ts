import { expect, test } from "@playwright/test";

/**
 * Screenshot tests, tagged @visual. Baselines are made by CI on Linux (the screenshots job commits any that are
 * missing), so fonts match. To accept a deliberate change, run the "Update screenshots" workflow.
 */
const THEMES = ["light", "dark", "holodeck"] as const;
const SIZES = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
];
const BLOCKS = ["buttons", "toolbar", "fields", "rail", "tree", "props", "menu", "dialog", "banner"];

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
    await expect(page.getByRole("region", { name: "Holodeck" })).toBeVisible();
    for (const block of BLOCKS) {
      const el = page.locator(`section[data-theme="${theme}"] [data-block="${block}"]`);
      await expect(el).toHaveScreenshot(`gallery-${theme}-${block}.png`, { maxDiffPixelRatio: 0.01 });
    }
  });
}
