import { expect, test } from "@playwright/test";
import { PITCH, ledCircuit, onCanvas, tools } from "./lib/electronics";

/** Kev (2026-11-27): a pin's net is named from the inspector, and double-clicking a pin or a pad goes to its field. */
test.describe("naming a pin's net", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("bettercad.toolbar"));
  });

  test("double-click a pin, name its net, and the board's pad follows", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("group", { name: "View cube" }).waitFor();
    await page.getByRole("tab", { name: "Electronics" }).click();
    await page
      .getByRole("tablist", { name: "Electronics views" })
      .getByRole("tab", { name: /^Schematic/ })
      .click();
    await ledCircuit(page);

    // The resistor's top pin, where the wire starts.
    await page.mouse.dblclick(...(await onCanvas(page, -10 * PITCH, 3.81)));
    const pin = page.getByLabel("Net on pin 1");
    await expect(pin).toBeFocused();
    await expect(async () => {
      await pin.fill("LAMP");
      await pin.press("Enter");
      await expect(pin).toHaveValue("LAMP");
    }).toPass();
    await expect(page.getByRole("img", { name: "Schematic, Sheet 1: 2 parts, 1 net" })).toBeVisible();

    // The resistor's far pin had no net: a name joins it to one.
    const far = page.getByLabel("Net on pin 2");
    await expect(far).toHaveAttribute("placeholder", "Not connected");
    await expect(async () => {
      await far.fill("GND");
      await far.press("Enter");
      await expect(far).toHaveValue("GND");
    }).toPass();
    await expect(page.getByRole("img", { name: "Schematic, Sheet 1: 2 parts, 2 nets" })).toBeVisible();

    await tools(page)
      .getByRole("button", { name: /^Push to PCB/ })
      .click();
    await page.getByRole("group", { name: "Push to PCB options" }).getByRole("button", { name: "Make the board" }).click();
    await expect(page.getByRole("img", { name: /^PCB: 2 parts/ })).toBeVisible();
    // Double-click R1's first pad: the inspector opens with its net's name, to change it on the board.
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Net on pin 1")).toHaveCount(0);
    await page.mouse.dblclick(...(await onCanvas(page, 61.55, 38.3)));
    await expect(page.getByLabel("Net on pin 1")).toBeFocused();
    await expect(page.getByLabel("Net on pin 1")).toHaveValue("LAMP");
  });
});
