import { expect, test, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number }; preset(p: string): void } };

/** A path on the ground (a 20 mm line, then a quarter bend of R10) and an R3 circle across its start, 4 mm up. */
function twoSketches(): string {
  const p = (id: string, x: number, y: number) => ({ id, kind: "point", x, y });
  const sketch = (id: string, name: string, plane: string, entities: unknown[]) => ({
    id,
    type: "sketch",
    name,
    sketch: { id, name, plane: { kind: "world", plane, offset: 0 }, entities, constraints: [], dimensions: [] },
  });
  const path = [
    p("a", 0, 0),
    p("b", 20, 0),
    p("c", 20, 10),
    p("d", 30, 10),
    { id: "ab", kind: "line", a: "a", b: "b" },
    { id: "bend", kind: "arc", c: "c", a: "b", b: "d", r: 10 },
  ];
  const ring = [p("o", 0, 4), { id: "r", kind: "circle", c: "o", r: 3 }];
  const document = {
    format: "bettercad",
    version: 2,
    name: "Sweep trial",
    looks: {},
    features: [sketch("s1", "Sketch 1", "XY", path), sketch("s2", "Sketch 2", "YZ", ring)],
  };
  const at = "2026-11-11T09:00:00.000Z";
  return JSON.stringify({ schema: 2, app: "bettercad", version: "0.1.0", created: at, modified: at, name: "Sweep trial", document });
}

async function drop(page: Page, name: string, text: string) {
  await page.evaluate(
    ({ name, text }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], name));
      const target = document.querySelector("[data-testid='view-canvas']")!;
      for (const type of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    { name, text },
  );
}

async function click(page: Page, x: number, y: number, z: number) {
  const q = await page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  await page.mouse.move(box.x + q.x, box.y + q.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

test("sweep a ring along a bent path into a pipe", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await drop(page, "sweep-trial.bcad", twoSketches());
  await expect(page.getByRole("treeitem", { name: /Sketch 2/ })).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => (window as unknown as View).__bcView.preset("iso"));
  await page.waitForTimeout(1200);

  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Sweep/ })
    .click();
  const panel = page.getByRole("group", { name: "Sweep options" });
  // Inside the ring, then the straight and the bend of the path.
  await expect(async () => {
    if (!(await panel.getByText("1 shape in Sketch 2").count())) await click(page, 0, 0, 4);
    await expect(panel.getByText("1 shape in Sketch 2")).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "OK", exact: true })).toHaveAttribute("aria-disabled", "true");
  await click(page, 12, 0, 0);
  await expect(panel.getByText("1 shape in Sketch 2, along 1 curve in Sketch 1")).toBeVisible();
  // The straight pipe is built now; let the view settle before clicking the bend.
  await expect(page.getByRole("treeitem", { name: /Body 1/ })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  const both = panel.getByText("1 shape in Sketch 2, along 2 curves in Sketch 1");
  await expect(async () => {
    if (!(await both.count())) await click(page, 20 + 10 * Math.SQRT1_2, 10 - 10 * Math.SQRT1_2, 0);
    await expect(both).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press("Enter");
  await expect(page.getByText("Swept 1 shape")).toBeVisible();

  // An R3 pipe 20 mm + a quarter of R10 long: 1,009.6 mm³.
  await page.getByRole("treeitem", { name: /Body 1/ }).click();
  await expect(page.getByText(/1,0\d\d\.\d mm³/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /Sweep 1/ })).toBeVisible();
});
