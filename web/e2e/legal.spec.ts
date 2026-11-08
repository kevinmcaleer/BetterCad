import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the privacy and terms pages say what is kept, and link to each other", async ({ page }) => {
  await page.goto("/#/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Page counts" })).toBeVisible();
  await expect(page.getByText(/no cookie, no IP address/)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: "terms" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Terms" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("sign-up links the terms and the privacy page", async ({ page }) => {
  await page.goto("/#/signup");
  await expect(page.getByRole("link", { name: "terms" })).toHaveAttribute("href", "#/terms");
  await expect(page.getByRole("link", { name: "privacy page" })).toHaveAttribute("href", "#/privacy");
});

test("the app counts a page once per session, and sends nothing about you", async ({ page }) => {
  const pings: string[] = [];
  await page.route("**/api/ping", async (r) => {
    expect(r.request().headers()["cookie"]).toBeUndefined();
    pings.push(r.request().postDataJSON().route as string);
    await r.fulfill({ status: 204 });
  });
  await page.goto("/#/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  await page.goto("/#/terms");
  // Let Terms open before leaving it: a hash change straight after another can skip its render, and so its count.
  await expect(page.getByRole("heading", { level: 1, name: "Terms" })).toBeVisible();
  await page.goto("/#/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  await expect.poll(() => pings).toEqual(["privacy", "terms"]);
});
