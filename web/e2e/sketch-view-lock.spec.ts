import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/** While a sketch is open the view stays square on to it: only the view cube turns it. */
test("the view doesn't tilt while sketching, and the view cube still turns it", async ({ page }) => {
  const ed = await new Editor(page).open();
  const view = page.getByRole("application", { name: /3D view/ });
  await ed.view.preset("top");
  await page.keyboard.press("k");
  await ed.view.clickUntil(20, 20, 0, ed.sketchTools);
  await page.waitForTimeout(800);
  await expect(view).toHaveAttribute("data-view", "top");

  // Arrow keys and a trackpad swipe pan instead of turning.
  await view.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  const box = (await ed.view.canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(30, 0.5);
  await page.waitForTimeout(400);
  await expect(view).toHaveAttribute("data-view", "top");

  // The view cube still turns it: its arrows show while it's square on to a face.
  await page.getByRole("group", { name: "View cube" }).getByRole("button", { name: "Turn clockwise 90°" }).click();
  await expect(view).toHaveAttribute("data-view", "free");

  // Once the sketch is finished, arrows turn the view again.
  // Focus is on the cube's button now, so finish from the sketch tools rather than Enter.
  await ed.sketchTools.getByRole("button", { name: "Finish sketch" }).click();
  await expect(ed.sketchTools).toHaveCount(0);
  await ed.view.preset("top");
  await view.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(view).toHaveAttribute("data-view", "free");
});
