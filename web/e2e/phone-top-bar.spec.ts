import { expect, test, type Page } from "@playwright/test";
import { fakeApi } from "./fakeApi";

// Phones: the top bar fits on one row, with nothing cut off at either end, and the editor never slides sideways.
test.use({ hasTouch: true, isMobile: true });

/** Every top-bar button that shows (the tools strip along the bottom scrolls on its own, so it is left out). */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const app = document.querySelector<HTMLElement>(".bc-app")!;
    const out: string[] = [];
    for (const b of document.querySelectorAll<HTMLElement>("header.bc-top button")) {
      if (b.closest(".bc-top-tools")) continue;
      const r = b.getBoundingClientRect();
      if (!r.width) continue;
      if (r.left < -0.5 || r.right > innerWidth + 0.5)
        out.push(`${b.getAttribute("aria-label") ?? b.title ?? b.textContent} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    return { out, scrollLeft: app.scrollLeft, page: document.documentElement.scrollWidth - innerWidth };
  });
}

for (const width of [360, 390]) {
  test(`the top bar fits a ${width} px phone, signed out and signed in`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("application", { name: /3D view/ })).toBeVisible();
    expect(await overflow(page)).toEqual({ out: [], scrollLeft: 0, page: 0 });

    const server = await fakeApi(context);
    await server.signIn(context);
    await page.reload();
    await expect(page.getByRole("banner").getByRole("button", { name: /account and settings/ })).toBeVisible();
    expect(await overflow(page)).toEqual({ out: [], scrollLeft: 0, page: 0 });
  });
}

test("on a phone, Parameters and Help sit in the account menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/");
  const top = page.getByRole("banner");
  await expect(top.getByRole("button", { name: "Help" })).toHaveCount(0);
  await expect(top.getByRole("button", { name: "Parameters", exact: true })).toHaveCount(0);
  await top.getByRole("button", { name: "Account and settings" }).click();
  const menu = page.getByRole("menu", { name: "Account and settings" });
  await expect(menu.getByRole("menuitem", { name: "Keyboard shortcuts" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Parameters" }).click();
  await expect(page.getByRole("dialog", { name: "Parameters" })).toBeVisible();
});
