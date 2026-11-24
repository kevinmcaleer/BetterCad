import { expect, test } from "@playwright/test";

// A phone: the compact bar along the bottom, with More tools for everything the ribbon holds.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("More tools on a phone opens the ribbon's tabs and starts a drawing", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("button", { name: "More tools" }).click();
  const sheet = page.getByRole("dialog", { name: "More tools" });
  await expect(sheet.getByRole("tab", { name: "Model" })).toHaveAttribute("aria-selected", "true");
  await expect(sheet.getByRole("region", { name: "Create" }).getByRole("button", { name: "Sweep" })).toBeVisible();

  await sheet.getByRole("tab", { name: "Assemble" }).click();
  await expect(sheet.getByRole("button", { name: "Joint", exact: true })).toBeVisible();

  await sheet.getByRole("tab", { name: "Drawing" }).click();
  await expect(sheet.getByText("This model has no drawings yet.")).toBeVisible();
  await sheet.getByRole("button", { name: "New drawing" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("dialog", { name: "New drawing" })).toBeVisible();
});

test("Esc closes More tools", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("button", { name: "More tools" }).click();
  await expect(page.getByRole("dialog", { name: "More tools" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "More tools" })).toBeHidden();
});
