import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const THEMES = ["light", "dark", "holoroom"] as const;

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
  await expect(page.getByRole("region", { name: "Holoroom" })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

for (const theme of THEMES) {
  test(`the sign-in page and the library have no axe violations in ${theme}`, async ({ page, context }) => {
    const { fakeApi } = await import("./fakeApi");
    const server = await fakeApi(context);
    await page.addInitScript((t) => localStorage.setItem("bettercad.theme", t), theme);
    await page.goto("/#/signin");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    const signIn = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(signIn.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    await server.signIn(context);
    await page.goto("/#/library");
    await page.reload();
    await page.getByRole("button", { name: "New model" }).first().click();
    await page.goto("/#/library");
    await expect(page.getByRole("button", { name: "Open Untitled model" })).toBeVisible();
    const library = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(library.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
}
