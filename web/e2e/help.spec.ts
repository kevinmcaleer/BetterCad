import { expect, test } from "@playwright/test";

test("Help lists shortcuts, the tour, the course, reports and About", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Help" }).click();
  for (const name of ["Keyboard shortcuts", "Take the tour", "Learn BetterCad", "Report a problem…", "What's new", "About BetterCad"]) {
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

test("What's new names new features after an update and lists them all from Help", async ({ page }) => {
  // A visitor who had seen every note but one: the newest is then new to them.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("bettercad.whatsNew.seen", JSON.stringify(["2000-01-01-old"]));
    }
  });
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible({ timeout: 60_000 });
  const card = page.getByRole("complementary", { name: "What's new" });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole("button", { name: "See what's new" }).click();
  const dialog = page.getByRole("dialog", { name: "What's new" });
  await expect(dialog.getByRole("article").first()).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("view-canvas")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("menuitem", { name: "What's new" }).click();
  await expect(page.getByRole("dialog", { name: "What's new" })).toBeVisible();
  await expect(card).toHaveCount(0);
});
