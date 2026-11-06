import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const THEMES = ["light", "dark", "holodeck"] as const;

for (const theme of THEMES) {
  test(`the editor has no axe violations in ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("bettercad.theme", t), theme);
    await page.goto("/");
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: "Box", exact: true }).click();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
}

test("the component gallery has no axe violations", async ({ page }) => {
  await page.goto("/#/gallery");
  await expect(page.getByRole("region", { name: "Holodeck" })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});
