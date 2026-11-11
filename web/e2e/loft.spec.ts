import { expect, test, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number }; preset(p: string): void } };

/** Two sketches: a 30 mm square on the ground and an R8 circle 30 mm above it. */
function twoSketches(): string {
  const p = (id: string, x: number, y: number) => ({ id, kind: "point", x, y });
  const l = (id: string, a: string, b: string) => ({ id, kind: "line", a, b });
  const sketch = (id: string, name: string, offset: number, entities: unknown[]) => ({
    id,
    type: "sketch",
    name,
    sketch: { id, name, plane: { kind: "world", plane: "XY", offset }, entities, constraints: [], dimensions: [] },
  });
  const square = [
    p("a", -15, -15),
    p("b", 15, -15),
    p("c", 15, 15),
    p("d", -15, 15),
    l("ab", "a", "b"),
    l("bc", "b", "c"),
    l("cd", "c", "d"),
    l("da", "d", "a"),
  ];
  const circle = [p("o", 0, 0), { id: "r", kind: "circle", c: "o", r: 8 }];
  const document = {
    format: "bettercad",
    version: 2,
    name: "Loft trial",
    looks: {},
    features: [sketch("s1", "Sketch 1", 0, square), sketch("s2", "Sketch 2", 30, circle)],
  };
  const at = "2026-11-11T09:00:00.000Z";
  return JSON.stringify({ schema: 2, app: "bettercad", version: "0.1.0", created: at, modified: at, name: "Loft trial", document });
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

test("loft a square on the ground into a circle 30 mm up", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await drop(page, "loft-trial.bcad", twoSketches());
  await expect(page.getByRole("treeitem", { name: /Sketch 2/ })).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => (window as unknown as View).__bcView.preset("iso"));
  await page.waitForTimeout(1200);

  await page.getByRole("toolbar", { name: "Model tools" }).getByRole("button", { name: /^Loft/ }).click();
  const panel = page.getByRole("group", { name: "Loft options" });
  // The square's corner, clear of the circle above it; then the circle.
  await expect(async () => {
    if (!(await panel.getByText("From Sketch 1").count())) await click(page, 12, 12, 0);
    await expect(panel.getByText("From Sketch 1")).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "OK", exact: true })).toHaveAttribute("aria-disabled", "true");
  await click(page, 0, 0, 30);
  await expect(panel.getByText("Through Sketch 1, then Sketch 2")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Lofted 2 shapes")).toBeVisible();

  // Between the circle's prism (6,032 mm³) and the square's (27,000 mm³).
  await page.getByRole("treeitem", { name: /Body 1/ }).click();
  await expect(page.getByText(/1\d,\d{3}\.\d mm³/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /Loft 1/ })).toBeVisible();
});
