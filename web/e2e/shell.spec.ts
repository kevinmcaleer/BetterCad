import { expect, test } from "@playwright/test";

test("the editor shell loads with its slots", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("BetterCad");
  await expect(page.getByRole("navigation", { name: "Panels" })).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "View tools" })).toBeVisible();
  await expect(page.getByRole("application", { name: /3D view/ })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Properties" })).toBeVisible();
});

test("keyboard: tools, undo and the command palette", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Extrude" })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("e");
  await expect(page.getByRole("button", { name: "Extrude" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Extrude" })).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.getByRole("treeitem")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("treeitem")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Command" }).fill("holodeck");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "holodeck");
});

test("the saved theme applies before first paint", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const first = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(first).toBe("dark");
  await page.evaluate(() => localStorage.setItem("bettercad.theme", "holodeck"));
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("holodeck");
});

test("the component gallery renders every theme", async ({ page }) => {
  await page.goto("/#/gallery");
  for (const name of ["Light", "Dark", "Holodeck"]) {
    await expect(page.getByRole("region", { name: `${name} theme` })).toBeVisible();
  }
});
