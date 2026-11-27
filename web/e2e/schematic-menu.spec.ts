import { expect, test } from "@playwright/test";
import { PITCH, ledCircuit, onCanvas, tools } from "./lib/electronics";

/** The schematic's right-click menu and net labels joined by name (#788). */
test.describe("schematic right-click", () => {
  // The ribbon, as electronics.spec.ts uses it: the Electronics tab holds the schematic's tools.
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("bettercad.toolbar"));
  });

  test("groups picked parts, and labels with one name show they are joined", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("group", { name: "View cube" }).getByRole("button", { name: "Fit", exact: true }).waitFor();
    await page.getByRole("tab", { name: "Electronics" }).click();
    await page
      .getByRole("tablist", { name: "Electronics views" })
      .getByRole("tab", { name: /^Schematic/ })
      .click();
    await ledCircuit(page);

    // Two labels with one name, from the menu on empty places.
    for (const x of [3, 10]) {
      await page.mouse.click(...(await onCanvas(page, x * PITCH, 4 * PITCH)), { button: "right" });
      await page
        .getByRole("menu", { name: "Schematic actions" })
        .getByRole("menuitem", { name: /Net label here/ })
        .click();
      await page.keyboard.type("LED_ON");
      await page.keyboard.press("Enter");
    }
    await page.mouse.click(...(await onCanvas(page, 3 * PITCH + 1, 4 * PITCH + 0.6)), { button: "right" });
    const menu = page.getByRole("menu", { name: "Schematic actions" });
    await expect(menu).toContainText("Net label LED_ON");
    await menu.getByRole("menuitemradio", { name: "Goes out" }).click();
    await page.mouse.move(...(await onCanvas(page, 10 * PITCH + 1, 4 * PITCH + 0.6)));
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/labels.png` });

    // Pick both parts, then right-click one of them to group them.
    await page.mouse.click(...(await onCanvas(page, -10 * PITCH, 0)));
    await page.keyboard.down("Shift");
    await page.mouse.click(...(await onCanvas(page, 0, 0)));
    await page.keyboard.up("Shift");
    await page.mouse.click(...(await onCanvas(page, -10 * PITCH, 0)), { button: "right" });
    await expect(menu.getByRole("menuitem", { name: /Group these/ })).toBeVisible();
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/menu.png` });
    await menu.getByRole("menuitem", { name: /Group these/ }).click();
    await expect(page.getByRole("textbox", { name: "Group name" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(tools(page).getByRole("button", { name: /^Group/ })).toBeVisible();
  });
});
