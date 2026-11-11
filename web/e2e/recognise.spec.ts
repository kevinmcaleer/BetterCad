import { expect, test } from "@playwright/test";

/** An ASCII STL of a 20 mm square plate, 5 mm thick, with a 6 mm hole through its middle, as a slicer would save it. */
function plateStl(n = 32, r = 3): string {
  const tris: number[][][] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => tris.push([a, b, c], [a, c, d]);
  const edge = (t: number) => {
    const [c, s] = [Math.cos(t), Math.sin(t)];
    const m = Math.max(Math.abs(c), Math.abs(s));
    return [(c / m) * 10, (s / m) * 10];
  };
  for (let i = 0; i < n; i++) {
    const [t0, t1] = [(i / n) * 2 * Math.PI, ((i + 1) / n) * 2 * Math.PI];
    const [p0, p1, q0, q1] = [[r * Math.cos(t0), r * Math.sin(t0)], [r * Math.cos(t1), r * Math.sin(t1)], edge(t0), edge(t1)];
    quad([...p0, 5], [...q0, 5], [...q1, 5], [...p1, 5]);
    quad([...p0, 0], [...p1, 0], [...q1, 0], [...q0, 0]);
    quad([...p0, 0], [...p0, 5], [...p1, 5], [...p1, 0]);
    quad([...q0, 0], [...q1, 0], [...q1, 5], [...q0, 5]);
  }
  const tri = (t: number[][]) => `facet normal 0 0 0\n outer loop\n${t.map((v) => `  vertex ${v.join(" ")}`).join("\n")}\n endloop\nendfacet\n`;
  return `solid plate\n${tris.map(tri).join("")}endsolid plate\n`;
}

test("an imported STL's hole becomes a Hole step you can change", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  await page.evaluate(
    ({ text, x, y }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], "plate.stl"));
      const target = document.querySelector("[data-testid='view-canvas']")!;
      for (const type of ["dragenter", "dragover", "drop"])
        target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
    },
    { text: plateStl(), x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  await expect(page.getByText(/Imported 1 body from plate\.stl.*Recognise features/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("treeitem", { name: /plate/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Recognise features…" }).click();
  const panel = page.getByRole("group", { name: "Recognise features options" });
  await expect(panel.getByRole("checkbox", { name: "6 mm hole, through" })).toBeChecked({ timeout: 30_000 });
  await panel.getByRole("button", { name: /Convert/ }).click();
  await expect(page.getByText("plate is now editable, with 1 hole you can change. The mesh is hidden.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Convert 1/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Hole 1/ }).first()).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /plate \(editable\)/ }).first()).toBeVisible();
  // The editable body is exact: the square less a true 6 mm cylinder.
  await expect(page.getByText("1,858.6 mm³")).toBeVisible({ timeout: 30_000 });
});
