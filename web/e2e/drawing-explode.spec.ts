import { expect, test } from "@playwright/test";
import { runCommand } from "./pages/editor";

/** Exploded views (#574): a view's Explode amount in the properties panel moves the parts apart on the sheet. */
test("explode a drawing view of the box and its lid", { tag: "@journey" }, async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Open the box with a lid sample" }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await runCommand(page, "New drawing");
  const card = page.getByRole("dialog", { name: "New drawing" });
  await card.getByLabel("Page size").selectOption("A3");
  await card.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("region", { name: "Drawing: Drawing 1" })).toBeVisible();
  await page.keyboard.press("b");
  const base = page.getByRole("dialog", { name: "Base view" });
  await expect(base.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await base.getByRole("button", { name: "Place" }).click();
  const view = page.getByRole("button", { name: /^Front view, / });
  const lines = view.locator(".bc-view-visible");
  await expect(lines).toHaveAttribute("d", /\d/, { timeout: 30_000 });
  const whole = (await view.locator(".bc-view-hit").boundingBox())!;
  const before = await lines.getAttribute("d");

  await view.focus();
  const explode = page.getByRole("textbox", { name: "Explode (%)" });
  await expect(explode).toHaveValue("0");
  await explode.fill("100");
  await explode.press("Enter");
  await expect(page.getByText(/Sizes between two parts are not the model's/)).toBeVisible();
  await expect(lines).not.toHaveAttribute("d", before!, { timeout: 30_000 });
  await expect.poll(async () => (await view.locator(".bc-view-hit").boundingBox())!.width, { timeout: 30_000 }).toBeGreaterThan(whole.width + 5);

  // Undo puts the parts back together.
  await page.keyboard.press("Control+z");
  await expect(explode).toHaveValue("0");
  await expect(lines).toHaveAttribute("d", before!, { timeout: 30_000 });
});
