import { expect, test } from "@playwright/test";
import { runCommand } from "./pages/editor";

/** Drawing view styles (Kev, 2026-11-24): a view's Style in the properties panel, drawn on the sheet. */
test("change a drawing view to shaded, rendered and wireframe from the properties panel", { tag: "@journey" }, async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Open the bracket sample" }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await runCommand(page, "New drawing");
  const card = page.getByRole("dialog", { name: "New drawing" });
  await card.getByLabel("Page size").selectOption("A3");
  await card.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("region", { name: "Drawing: Drawing 1" })).toBeVisible();
  await page.keyboard.press("b");
  const base = page.getByRole("dialog", { name: "Base view" });
  await base.getByLabel("Direction").selectOption({ label: "Isometric, front right" });
  await expect(base.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await base.getByRole("button", { name: "Place" }).click();
  const view = page.getByRole("button", { name: /^Isometric view, / });
  await expect(view.locator(".bc-view-visible")).toHaveAttribute("d", /\d/, { timeout: 30_000 });

  // Selecting the view puts its Style in the properties panel, line art to start with.
  await view.focus();
  const style = page.getByRole("combobox", { name: "Style" });
  await expect(style).toHaveValue("lineart");

  await style.selectOption("Shaded");
  const picture = view.locator("image.bc-view-picture");
  await expect(picture).toHaveAttribute("href", /^data:image\/jpeg/, { timeout: 30_000 });
  await expect(view.locator(".bc-view-visible")).toHaveCount(1);
  await expect(view.locator(".bc-view-hidden")).toHaveCount(0);

  // Rendered shows the shaded picture, with no lines, until the path tracer is done (minutes on CI's software WebGL).
  await style.selectOption("Rendered");
  await expect(view.locator(".bc-view-visible")).toHaveCount(0);
  await expect(picture).toHaveAttribute("href", /^data:image\/jpeg/);

  await style.selectOption("Wireframe");
  await expect(picture).toHaveCount(0);
  await expect(view.locator(".bc-view-visible")).toHaveCount(2, { timeout: 30_000 });

  // Undo goes back a style at a time.
  await page.keyboard.press("Control+z");
  await expect(style).toHaveValue("rendered");
});
