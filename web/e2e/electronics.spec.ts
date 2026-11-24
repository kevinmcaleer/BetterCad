import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ledCircuit, onCanvas, pick, tools } from "./lib/electronics";

const axe = async (page: import("@playwright/test").Page) => {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
};

/** Electronics (#606): a schematic, pushed to a board, with the 3D model one click away. */
test.describe("on a wide screen", () => {
  // The ribbon, as ribbon.spec.ts turns it on: the Electronics tab holds the open view's tools.
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("bettercad.toolbar"));
  });

  test("draw a schematic, push it to a PCB and come back to the model", { tag: "@journey" }, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("group", { name: "View cube" }).getByRole("button", { name: "Fit", exact: true }).waitFor();
    await page.getByRole("tab", { name: "Electronics" }).click();
    await page.getByRole("button", { name: "Schematic", exact: true }).click();

    // The schematic takes the view: its own tools on the Electronics tab, the switcher, and a way to start.
    await expect(page.getByRole("img", { name: "Schematic, Sheet 1: 0 parts, 0 nets" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Schematic" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Start with a part.")).toBeVisible();
    await expect(page.getByRole("group", { name: "View cube" }).getByRole("button", { name: "Fit", exact: true })).toBeHidden();

    await ledCircuit(page);
    await expect(page.getByRole("img", { name: "Schematic, Sheet 1: 2 parts, 1 net" })).toBeVisible();
    // The browser lists the design, and the part card shows a picked part.
    const tree = page.getByRole("tree");
    await expect(tree.getByRole("button", { name: /^Electronics/ })).toContainText("2 parts");
    await page.mouse.click(...(await onCanvas(page, -25.4, 0)));
    await expect(page.getByLabel("Value")).toHaveValue("10 kΩ");
    await page.getByLabel("Value").fill("330 Ω");
    await page.keyboard.press("Escape");
    await axe(page);

    // Push to PCB says what it will do first.
    await tools(page)
      .getByRole("button", { name: /^Push to PCB/ })
      .click();
    const card = page.getByRole("group", { name: "Push to PCB options" });
    await expect(card.getByRole("listitem")).toHaveText(["Make a 2-layer board, 1.6 mm thick", "Add D1 beside the board", "Add R1 beside the board"]);
    await card.getByRole("button", { name: "Make the board" }).click();
    await expect(page.getByRole("tab", { name: "PCB" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("img", { name: /^PCB: 2 parts/ })).toBeVisible();
    const status = page.getByRole("status", { name: "Electronics status" });
    await expect(status).toContainText("1 connection left to route");
    await expect(status).toContainText("Board 50 × 40 mm");
    await expect(page.getByRole("region", { name: "Layers" }).getByRole("button", { name: "Top copper", exact: true })).toHaveAttribute("aria-pressed", "true");
    await axe(page);

    // A new part on the schematic leaves the board one change behind, and says so on the tab.
    await page.keyboard.press("1");
    await expect(page.getByRole("tab", { name: "Schematic" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("p");
    await pick(page, "Capacitor");
    await page.mouse.click(...(await onCanvas(page, 25.4, 0)));
    await page.keyboard.press("Escape");
    await expect(page.getByRole("img", { name: "1 change behind the schematic" })).toBeVisible();
    await page.getByRole("button", { name: "PCB is 1 change behind" }).click();
    await page.getByRole("group", { name: "Update the board options" }).getByRole("button", { name: "Update the board" }).click();
    await expect(page.getByRole("img", { name: /^PCB: 3 parts/ })).toBeVisible();

    // 3 goes back to the model, with its own tools; undo takes the last change away without leaving it.
    await page.keyboard.press("3");
    await expect(page.getByRole("group", { name: "View cube" }).getByRole("button", { name: "Fit", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: /^PCB/ })).toBeHidden();
    await tree.getByRole("button", { name: /^Schematic/ }).dblclick();
    await expect(page.getByRole("img", { name: "Schematic, Sheet 1: 3 parts, 1 net" })).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the schematic and the board work by touch, with the tools along the bottom", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("banner").getByRole("button", { name: "More tools" }).click();
    const sheet = page.getByRole("dialog", { name: "More tools" });
    await sheet.getByRole("tab", { name: "Electronics" }).click();
    await sheet.getByRole("button", { name: "Schematic", exact: true }).click();
    await expect(page.getByRole("toolbar", { name: "Schematic tools" })).toBeVisible();

    await ledCircuit(page, true);
    await tools(page)
      .getByRole("button", { name: /^Push to PCB/ })
      .click();
    await page.getByRole("group", { name: "Push to PCB options" }).getByRole("button", { name: "Make the board" }).click();
    await expect(page.getByRole("status", { name: "Electronics status" })).toContainText("1 connection left to route");
    // Nothing runs off the side of the screen, and the layers fold to one chip.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const layers = page.getByRole("region", { name: "Layers" });
    await expect(layers.getByRole("button", { name: "Bottom copper", exact: true })).toBeHidden();
    await layers.getByRole("button", { name: "Top copper", exact: true }).first().click();
    await expect(layers.getByRole("button", { name: "Bottom copper", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "3D" }).click();
    await expect(page.getByRole("toolbar", { name: "PCB tools" })).toBeHidden();
  });
});
