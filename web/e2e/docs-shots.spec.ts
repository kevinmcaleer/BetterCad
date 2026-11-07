import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * `npm run docs:shots` (#110): each sample in each theme, for the Learn BetterCad lessons. Re-run it when the UI
 * changes; the pictures land in docs/images/. Tagged @docs so the normal run skips it.
 */
const SAMPLES = ["bracket", "box-with-lid", "phone-stand", "hole-calibration"];
const THEMES = ["light", "dark", "holodeck"] as const;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "images");

test.describe("@docs", () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  for (const theme of THEMES) {
    for (const sample of SAMPLES) {
      test(`${sample} in ${theme}`, async ({ page }) => {
        mkdirSync(OUT, { recursive: true });
        await page.addInitScript((t) => localStorage.setItem("bettercad.theme", t), theme);
        await page.goto(`/#/sample/${sample}`);
        await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
        await page.waitForTimeout(1500);
        await page.screenshot({ path: join(OUT, `${sample}-${theme}.png`) });
      });
    }
  }
});
