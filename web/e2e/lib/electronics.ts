import { expect, type Page } from "@playwright/test";

/** The schematic's and the board's grid pitch for parts, mm. */
export const PITCH = 2.54;

/** Where a point of the schematic or the board (mm, y up) is on the page. The canvas says where its drawing sits. */
export async function onCanvas(page: Page, x: number, y: number): Promise<[number, number]> {
  const canvas = page.getByRole("img", { name: /^(Schematic|PCB)/ });
  const [scale, ox, oy] = (await canvas.getAttribute("data-view"))!.split(" ").map(Number) as [number, number, number];
  const box = (await canvas.boundingBox())!;
  return [box.x + ox + x * scale, box.y + oy - y * scale];
}

/** Clicks, or taps on a touch screen, a point of the drawing. */
export async function press(page: Page, x: number, y: number, touch = false) {
  const [px, py] = await onCanvas(page, x, y);
  if (touch) await page.touchscreen.tap(px, py);
  else await page.mouse.click(px, py);
}

/** The tools of the open view: on the ribbon's Electronics tab, or the compact bar over the view. */
export const tools = (page: Page) => page.getByRole("toolbar", { name: /^(Schematic|PCB|Electronics) tools$/ });

/** Picks a part from the Components card, places it, and lets go of it. */
export async function place(page: Page, part: RegExp, x: number, y: number, touch = false) {
  const components = tools(page).getByRole("button", { name: /^Components/ });
  await components.click();
  await page.getByRole("group", { name: "Components options" }).getByRole("button", { name: part }).click();
  await press(page, x, y, touch);
  await components.click();
  await expect(components).toHaveAttribute("aria-pressed", "false");
}

/** A resistor and an LED with their top pins wired together. */
export async function ledCircuit(page: Page, touch = false) {
  await place(page, /^Resistor/, -10 * PITCH, 0, touch);
  await place(page, /^LED/, 0, 0, touch);
  const status = page.getByRole("status", { name: "Electronics status" });
  await expect(status).toContainText("4 pins or wire ends are not connected");
  const wire = tools(page).getByRole("button", { name: /^Wire/ });
  await wire.click();
  await press(page, -10 * PITCH, 3.81, touch);
  await press(page, 0, 3.81, touch);
  await expect(status).toContainText("2 pins or wire ends are not connected");
  await wire.click();
}
