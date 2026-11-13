import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/** Arc kinds (#405): a line, then the Arc tool's Tangent kind carries an arc on from its end, tangent to it. */
test("draw a tangent arc on from a line's end", async ({ page }) => {
  test.setTimeout(90_000);
  const ed = await new Editor(page).open();
  await ed.view.preset("top");
  await page.keyboard.press("k");
  await expect(ed.said("Click a face or a plane to sketch on it.").first()).toBeVisible();
  await ed.view.clickUntil(30, 30, 0, ed.sketchTools);
  await page.waitForTimeout(800);
  // A new sketch starts with Line armed.
  await expect(ed.sketchTools.getByRole("button", { name: /^Line/, pressed: true })).toBeVisible();
  await ed.view.click(0, 0);
  await ed.view.click(20, 0);
  await page.keyboard.press("Escape");

  await page.keyboard.press("a");
  const kinds = page.getByRole("group", { name: "Arc kind" });
  await kinds.getByRole("button", { name: "Tangent" }).click();
  await expect(ed.said("Click the end of a line or arc, then where the arc ends. It carries on tangent. Type the radius.").first()).toBeVisible();
  await ed.view.click(20, 0);
  await ed.view.click(30, 10);
  // A level line from the origin (its length free) and an arc held tangent at its start (its sweep and size free).
  await expect(page.getByText("3 degrees of freedom").first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Constraints" }).getByRole("listitem").filter({ hasText: "Tangent" })).toHaveCount(1);
  await expect(kinds.getByRole("button", { name: "Tangent" })).toHaveAttribute("aria-pressed", "true");
});
