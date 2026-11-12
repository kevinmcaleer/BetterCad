import { expect, test } from "@playwright/test";
import { Editor, bodyRows } from "./pages/editor";

// The other specs pin the compact bar (playwright.config.ts); these turn Automatic back on, on a wide window.
test.use({ viewport: { width: 1440, height: 900 } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("bettercad.toolbar"));
});

test("wide screens with a mouse get the ribbon: tabs, big tools and a drop-down per group", async ({ page }) => {
  await page.goto("/");
  const bar = page.getByRole("banner");
  await expect(bar.getByRole("tab", { name: "Model" })).toHaveAttribute("aria-selected", "true");
  const tools = bar.getByRole("toolbar", { name: "Model tools" });
  await expect(tools.getByRole("group", { name: "Create" }).getByRole("button", { name: "Extrude" })).toBeVisible();

  // E arms Extrude, and its ribbon button shows it.
  await page.keyboard.press("e");
  await expect(tools.getByRole("button", { name: "Extrude" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // A group's name lists every tool in it; Library adds a shape.
  await tools.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menu", { name: "Insert tools" }).getByRole("menuitem", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(bodyRows(page)).toHaveCount(1);

  // The colour icons load after first paint and take over from the line icons.
  await expect(tools.locator(".bc-icon-colour").first()).toBeVisible();

  await bar.getByRole("tab", { name: "Assemble" }).click();
  await expect(bar.getByRole("tabpanel").getByRole("button", { name: "Joint", exact: true })).toBeVisible();
});

test("the Sketch tab takes over while sketching, and Finish sketch closes it", async ({ page }) => {
  const ed = await new Editor(page).open();
  await page.keyboard.press("k");
  await ed.view.clickUntil(20, 15, 0, ed.sketchTools);
  const bar = page.getByRole("banner");
  await expect(bar.getByRole("tab", { name: "Sketch" })).toHaveAttribute("aria-selected", "true");
  const tools = bar.getByRole("toolbar", { name: "Sketch tools" });
  await expect(tools.getByRole("button", { name: "Rectangle" })).toBeVisible();
  // The strip under the view keeps only the armed tool's options.
  await expect(page.getByRole("toolbar", { name: "Sketch tools" })).toHaveCount(1);
  await tools.getByRole("button", { name: "Finish sketch" }).click();
  await expect(bar.getByRole("tab", { name: "Sketch" })).toHaveCount(0);
  await expect(bar.getByRole("tab", { name: "Model" })).toHaveAttribute("aria-selected", "true");
});

test("Settings switches to the compact bar", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Account and settings/ }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Compact" }).check();
  await expect(page.getByRole("banner").getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("toolbar", { name: "Model tools" }).getByRole("button", { name: "Sweep" })).toBeVisible();
});
