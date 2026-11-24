import { expect, test, type Locator, type Page } from "@playwright/test";
import { runCommand } from "./pages/editor";

type View = { __bcView: { project(p: number[]): { x: number; y: number }; preset(p: string): void } };

async function at(page: Page, x: number, y: number, z = 0) {
  // Wait for the camera to stop, so the point is where it will be.
  const where = () => page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  let q = await where();
  let still = 0;
  for (let i = 0; i < 80 && still < 4; i++) {
    await page.waitForTimeout(50);
    const r = await where();
    still = Math.abs(r.x - q.x) < 0.5 && Math.abs(r.y - q.y) < 0.5 ? still + 1 : 0;
    q = r;
  }
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  return { x: box.x + q.x, y: box.y + q.y };
}

async function click(page: Page, x: number, y: number) {
  const p = await at(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

/** Clicks until the tool takes the click: under load the first can land before the view is ready. */
async function clickUntil(page: Page, x: number, y: number, done: Locator) {
  await expect(async () => {
    if (!(await done.count())) await click(page, x, y);
    await expect(done).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
}

/** Edit in model (#564): a drawing's sizes report, so a double-click goes to the sketch dimension that sets one. */
test("double-click a size on a drawing to edit the sketch dimension that sets it @journey", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
  await page.waitForTimeout(1200);

  // A 30 × 20 mm plate, 12 mm thick, from a sketch with its two sizes.
  await page.keyboard.press("k");
  await clickUntil(page, 20, 20, page.getByRole("toolbar", { name: "Sketch tools" }));
  await page.waitForTimeout(800);
  await page.keyboard.press("r");
  await click(page, -10, -10);
  const far = await at(page, 10, 5);
  await page.mouse.move(far.x, far.y, { steps: 3 });
  await page.getByRole("textbox", { name: "Width" }).fill("30");
  await page.keyboard.press("Tab");
  await page.getByRole("textbox", { name: "Height" }).fill("20");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Finished Sketch 1")).toBeVisible();
  await page.keyboard.press("e");
  const distance = page.getByRole("textbox", { name: "Distance" });
  await clickUntil(page, 0, 0, distance);
  await distance.fill("12");
  await distance.press("Enter");
  await expect(page.getByText("Extruded one shape 12 mm")).toBeVisible();

  // A drawing with a top view, and the plate's 30 mm edge dimensioned.
  await runCommand(page, "New drawing");
  await page.getByRole("dialog", { name: "New drawing" }).getByRole("button", { name: "Create" }).click();
  const sheet = page.getByRole("region", { name: /^Drawing: / });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("b");
  const base = page.getByRole("dialog", { name: "Base view" });
  await expect(base.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await base.getByLabel("Direction").selectOption({ label: "Top" });
  await expect(base.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await base.getByRole("button", { name: "Place" }).click();
  const top = page.getByRole("button", { name: /^Top view, / });
  await expect(top.locator(".bc-view-visible")).toHaveAttribute("d", /M/, { timeout: 30_000 });
  await page.keyboard.press("d");
  const card = page.getByRole("dialog", { name: "Dimension" });
  await page.getByRole("button", { name: "Edge, 30 mm long" }).first().click({ force: true });
  await card.getByRole("button", { name: "Place" }).click();
  await card.getByRole("button", { name: "Finish" }).click();
  const size = page.getByRole("button", { name: "Dimension, 30 mm" });
  await expect(size).toBeVisible();

  // Selected, the properties panel says where the model sets it, and gives it decimal places of its own.
  await size.focus();
  const props = page.getByRole("complementary", { name: "Properties" });
  await expect(props.getByText("Set by d1 in Sketch 1. A drawing's sizes follow the model, so change it there.")).toBeVisible();
  await expect(props.getByLabel("Decimal places")).toHaveValue("");
  await expect(props.getByRole("button", { name: "Edit in model" })).toBeVisible();

  // A double-click leaves the drawing for the sketch, with that dimension open for typing.
  await size.locator("text").dblclick();
  await expect(page.getByText("Editing Sketch 1. Enter finishes.").first()).toBeVisible();
  await expect(sheet).toHaveCount(0);
  const input = page.getByRole("textbox", { name: "Size in mm" });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("30");
  await input.fill("36");
  await input.press("Enter");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Finished Sketch 1").first()).toBeVisible();

  // Back on the drawing, the size has followed the model.
  await page.getByRole("treeitem", { name: /^Drawing 1/ }).dblclick();
  await expect(sheet).toBeVisible();
  await expect(page.getByRole("button", { name: "Dimension, 36 mm" })).toBeVisible({ timeout: 30_000 });

  // The plate's thickness is the Extrude's number: the menu's Edit in model opens that step.
  await page.keyboard.press("b");
  await expect(base.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await base.getByRole("button", { name: "Place" }).click();
  await expect(page.getByRole("button", { name: /^Front view, / }).locator(".bc-view-visible")).toHaveAttribute("d", /M/, { timeout: 30_000 });
  await page.keyboard.press("d");
  await page.getByRole("button", { name: "Edge, 12 mm long" }).first().click({ force: true });
  await card.getByRole("button", { name: "Place" }).click();
  await card.getByRole("button", { name: "Finish" }).click();
  await page.getByRole("button", { name: "Dimension, 12 mm" }).locator("text").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit in model" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Distance" })).toHaveValue("12");
});
