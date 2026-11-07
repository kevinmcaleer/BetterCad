import { expect, test } from "@playwright/test";

test("Help lists shortcuts, the tour, the course, reports and About", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Help" }).click();
  for (const name of ["Keyboard shortcuts", "Take the tour", "Learn BetterCad", "Report a problem…", "About BetterCad"]) {
    await expect(page.getByRole("menuitem", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await page.getByRole("menuitem", { name: "About BetterCad" }).click();
  const about = page.getByRole("dialog", { name: "About BetterCad" });
  await expect(about.getByText(/^Version /)).toBeVisible();
  await expect(about.getByRole("link", { name: "OpenCascade Technology" })).toBeVisible();
  await expect(about.getByText("Sketch constraints. LGPL 2.0 or later.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(about).toHaveCount(0);

  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("menuitem", { name: /^Keyboard shortcuts/ }).click();
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
});

test("Learn BetterCad opens the course in a new tab", async ({ page, context }) => {
  await context.route("https://www.kevsrobots.com/**", (r) => r.fulfill({ body: "course" }));
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Help" }).click();
  const [tab] = await Promise.all([context.waitForEvent("page"), page.getByRole("menuitem", { name: "Learn BetterCad" }).click()]);
  expect(tab.url()).toContain("kevsrobots.com/learn/bettercad");
});
