import { expect, test, type Page } from "@playwright/test";

/** An ASCII STL of a 10 mm cube with its corner at the origin. */
function cubeStl(): string {
  const p = (x: number, y: number, z: number) => [x * 10, y * 10, z * 10];
  const quads = [
    [p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)],
    [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)],
    [p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)],
    [p(1, 1, 0), p(0, 1, 0), p(0, 1, 1), p(1, 1, 1)],
    [p(0, 1, 0), p(0, 0, 0), p(0, 0, 1), p(0, 1, 1)],
    [p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)],
  ];
  const tri = (a: number[], b: number[], c: number[]) =>
    `facet normal 0 0 0\n outer loop\n${[a, b, c].map((v) => `  vertex ${v.join(" ")}`).join("\n")}\n endloop\nendfacet\n`;
  return `solid cube\n${quads.map(([a, b, c, d]) => tri(a!, b!, c!) + tri(a!, c!, d!)).join("")}endsolid cube\n`;
}

/** Drops files on the middle of the view, as dragging them from the desktop does. */
async function drop(page: Page, files: { name: string; text: string }[]) {
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  await page.evaluate(
    ({ files, x, y }) => {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(new File([f.text], f.name));
      const target = document.querySelector("[data-testid='view-canvas']")!;
      for (const type of ["dragenter", "dragover", "drop"]) {
        target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
      }
    },
    { files, x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
}

test("dropping an STL on the view adds it as a body you can measure", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await drop(page, [{ name: "cube.stl", text: cubeStl() }]);
  await expect(page.getByText("Imported 1 body from cube.stl")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("treeitem", { name: /cube/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Import 1/ }).first()).toBeVisible();
  await expect(page.getByText("1,000 mm³")).toBeVisible({ timeout: 30_000 });
});

test("refuses files it can't open, and more than one model at once", async ({ page }) => {
  await page.goto("/");
  await drop(page, [{ name: "notes.txt", text: "hello" }]);
  await expect(page.getByText("BetterCad opens .bcad, .stl, .step and .3mf files")).toBeVisible();
  await drop(page, [
    { name: "a.bcad", text: "{}" },
    { name: "b.bcad", text: "{}" },
  ]);
  await expect(page.getByText("Drop one BetterCad file at a time")).toBeVisible();
});
