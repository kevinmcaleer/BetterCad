import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/**
 * Modelling on a posed model, as in Fusion: the model stays where its joints put it while you sketch and extrude, and
 * what you draw on a turned part lands where you drew it and turns with it.
 */

type View = { __bcView: { project(p: number[]): { x: number; y: number }; pick(x: number, y: number, f: string): { body: string } | null } };

// A 40 × 10 × 10 mm arm along +X from the origin, in a component on a hinge about Z, turned 90° so it points along +Y.
const doc = {
  format: "bettercad",
  version: 2,
  name: "Arm",
  looks: {},
  features: [
    { id: "a", name: "Arm", type: "add", part: { id: "arm", name: "Arm", kind: "box", position: { x: 20, y: 0, z: 0 }, size: { x: 40, y: 10, z: 10 } } },
    { id: "L", name: "Arm link", type: "link", parts: ["arm"] },
    { id: "J", name: "Joint 1", type: "joint", kind: "revolute", child: "L", parent: null, origin: [0, 0, 0], axis: [0, 0, 1], lower: -180, upper: 180 },
  ],
  pose: { J: 90 },
};

test("a sketch and extrude on a turned part land where you draw them", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript((text) => {
    const file = { kind: "file", name: "Arm.bcad", getFile: async () => new File([text], "Arm.bcad"), queryPermission: async () => "granted" };
    (window as unknown as Record<string, unknown>).showOpenFilePicker = async () => [file];
  }, JSON.stringify(doc));
  const ed = await new Editor(page).open();
  await page.keyboard.press("ControlOrMeta+o");
  await expect(page.getByText("Opened Arm.bcad")).toBeVisible();
  await ed.kernelReady();
  await ed.view.preset("top");

  // Turned, the arm's top is over (0, 30); at home nothing is there.
  await page.keyboard.press("k");
  await ed.view.clickUntil(0, 30, 10, ed.sketchTools);
  await expect(ed.said(/^Sketching on a face/)).toBeVisible();
  await page.waitForTimeout(800);
  await page.keyboard.press("r");
  await ed.view.click(-3, 26, 10);
  await ed.view.click(3, 34, 10);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(ed.said("Finished Sketch 1")).toBeVisible();

  await page.keyboard.press("e");
  const distance = ed.field("Distance");
  await ed.view.clickUntil(0, 30, 10, distance);
  await distance.fill("5");
  await distance.press("Tab");

  // From the front, 2.5 mm above the arm's top is the new block over x = 0, not where it would sit at home (x = 30).
  await ed.view.preset("front");
  const box = (await ed.view.canvas.boundingBox())!;
  const hit = async (x: number, y: number, z: number) => {
    const at = await ed.view.at(x, y, z);
    return page.evaluate((p) => (window as unknown as View).__bcView.pick(p.x, p.y, "body")?.body ?? null, { x: at.x - box.x, y: at.y - box.y });
  };
  await expect.poll(() => hit(0, 30, 12.5)).toBe("arm");
  expect(await hit(30, 0, 12.5)).toBeNull();
  // Kept, the model stays posed with the block on it.
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(ed.said("Extruded one shape 5 mm")).toBeVisible();
  await expect.poll(() => hit(0, 30, 12.5)).toBe("arm");
  await page.screenshot({ path: test.info().outputPath("posed-extrude.png") });
});
