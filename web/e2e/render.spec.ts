import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

// Close the page ourselves: SwiftShader can leave the context's own close waiting long enough to stall the next test.
test.afterEach(async ({ page }) => page.close());

/** Render (#197): a path-traced picture over the view. Esc goes back to modelling. */
test("Render switches the view to a path-traced picture, and Esc goes back", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => ((window as unknown as { __bcRenderMax: number }).__bcRenderMax = 2));
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.getByRole("button", { name: "Pick: Bodies" }).waitFor();

  await page.keyboard.press("Shift+R");
  const bar = page.getByRole("group", { name: "Render options" });
  await expect(bar).toBeVisible();
  await expect(page.getByRole("img", { name: /Rendered picture of the model/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pick: Bodies" })).toHaveCount(0);
  await expect(bar.getByRole("status")).toHaveText("2 of 2 samples", { timeout: 120_000 });

  // The render has its own view cube, turning the picture; the modelling view comes back looking the same way.
  const cube = page.getByRole("group", { name: "View cube" });
  await expect(cube).toHaveCount(1);
  await cube.getByRole("button", { name: "Look from the top" }).click({ force: true });
  await expect(bar.getByRole("status")).toHaveText("2 of 2 samples", { timeout: 120_000 });

  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole("img", { name: /Rendered picture/ })).toHaveCount(0);
  await expect(page.getByRole("application", { name: /3D view/ })).toHaveAttribute("data-view", "top");
  await expect(page.getByRole("button", { name: "Pick: Bodies" })).toBeVisible();

  // The view style menu opens it too, in paper white.
  await page.getByRole("button", { name: /^(Shaded|Line art)$/ }).click();
  await page.getByRole("menuitem", { name: "Render in paper" }).click();
  await expect(bar.getByRole("button", { name: "Paper" })).toHaveAttribute("aria-pressed", "true");
  // A software GPU (CI) takes a while to build the path tracer's shader; wait for it before pressing Done.
  await expect(bar.getByRole("status")).toHaveText("2 of 2 samples", { timeout: 120_000 });
  await bar.getByRole("button", { name: "Done" }).click();
  await expect(bar).toHaveCount(0);
});

/** The middle of the render canvas, averaged: is the box there coloured or paper white? */
async function middleColour(page: import("@playwright/test").Page): Promise<[number, number, number]> {
  return page.locator(".bc-render-canvas").evaluate((el: HTMLCanvasElement) => {
    const c = document.createElement("canvas");
    c.width = c.height = 8;
    const g = c.getContext("2d")!;
    g.drawImage(el, el.width * 0.45, el.height * 0.45, el.width * 0.1, el.height * 0.1, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k];
    return sum.map((v) => v / 64) as [number, number, number];
  });
}

test("switching an open render to Paper drops the colours", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => ((window as unknown as { __bcRenderMax: number }).__bcRenderMax = 2));
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.getByRole("group", { name: "Colour" }).getByRole("button", { name: "Orange" }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+R");
  const bar = page.getByRole("group", { name: "Render options" });
  const status = bar.getByRole("status");
  await expect(status).toHaveText("2 of 2 samples", { timeout: 200_000 });
  const [r, , b] = await middleColour(page);
  expect(r - b).toBeGreaterThan(60);

  await bar.getByRole("button", { name: "Paper" }).click({ force: true });
  await expect(status).not.toHaveText("2 of 2 samples", { timeout: 30_000 });
  await expect(status).toHaveText("2 of 2 samples", { timeout: 200_000 });
  const [pr, , pb] = await middleColour(page);
  expect(pr - pb).toBeLessThan(30);
});

test("Save image saves the picture already rendered, without rendering it again", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    (window as unknown as { __bcRenderMax: number }).__bcRenderMax = 2;
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.keyboard.press("Shift+R");
  const bar = page.getByRole("group", { name: "Render options" });
  await expect(bar.getByRole("status")).toHaveText("2 of 2 samples", { timeout: 200_000 });
  const shown = await page.locator(".bc-render-canvas").evaluate((el: HTMLCanvasElement) => el.toDataURL("image/png"));

  const download = page.waitForEvent("download");
  await bar.getByRole("button", { name: "Save image" }).click({ force: true });
  await page.getByRole("menuitem", { name: "View size", exact: true }).click({ force: true });
  const saved = `data:image/png;base64,${(await readFile(await (await download).path())).toString("base64")}`;
  await expect(bar.getByRole("status")).toHaveText("2 of 2 samples");

  // Two samples are grainy, so a fresh render would differ pixel by pixel; the saved file is the very same picture.
  const diff = await page.evaluate(
    async ([a, b]) => {
      const pixels = async (url: string) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height).data;
      };
      const [p, q] = [await pixels(a), await pixels(b)];
      if (p.length !== q.length) return 255;
      let sum = 0;
      for (let i = 0; i < p.length; i++) sum += Math.abs(p[i] - q[i]);
      return sum / p.length;
    },
    [shown, saved],
  );
  expect(diff).toBeLessThan(1);
});

test("Save image at a bigger size asks where to save straight away, while the click still counts", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    (window as unknown as { __bcRenderMax: number }).__bcRenderMax = 2;
    // Like Chrome, the picker only opens straight after a click. Chrome allows a few seconds, more than a render
    // takes here, so this asks for it within 300 ms of the click: before the picture is made, not after.
    let clicked = 0;
    window.addEventListener("pointerup", () => (clicked = performance.now()), true);
    (window as unknown as Record<string, unknown>).showSaveFilePicker = async (o: { suggestedName: string }) => {
      if (performance.now() - clicked > 300) throw new DOMException("Must be handling a user gesture to show a file picker.", "SecurityError");
      return {
        name: o.suggestedName,
        createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      };
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.keyboard.press("Shift+R");
  const bar = page.getByRole("group", { name: "Render options" });
  await expect(bar.getByRole("status")).toHaveText("2 of 2 samples", { timeout: 200_000 });
  await bar.getByRole("button", { name: "Save image" }).click({ force: true });
  await page.getByRole("menuitem", { name: "Twice the view size" }).click({ force: true });
  await expect(page.getByText(/Saved .* 2x\.png/)).toBeVisible({ timeout: 200_000 });
});

test("a rendered box at a fixed sample count @visual", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 900, height: 600 });
  await page.addInitScript(() => ((window as unknown as { __bcRenderMax: number }).__bcRenderMax = 4));
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.getByRole("group", { name: "Colour" }).getByRole("button", { name: "Orange" }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+R");
  await expect(page.getByRole("group", { name: "Render options" }).getByRole("status")).toHaveText("4 of 4 samples", { timeout: 200_000 });
  // Four samples are grainy and the grain differs every run, so compare the picture shrunk to 60 × 40: halving it
  // step by step averages each pixel with its neighbours, which keeps the shape, colour and shadow and drops the grain.
  const url = await page.locator(".bc-render-canvas").evaluate((el: HTMLCanvasElement) => {
    let src: HTMLCanvasElement = el;
    while (src.width > 120) {
      const half = document.createElement("canvas");
      half.width = Math.max(60, Math.round(src.width / 2));
      half.height = Math.max(40, Math.round(src.height / 2));
      const g = half.getContext("2d")!;
      g.imageSmoothingQuality = "high";
      g.drawImage(src, 0, 0, half.width, half.height);
      src = half;
    }
    const out = document.createElement("canvas");
    out.width = 60;
    out.height = 40;
    const g = out.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    g.drawImage(src, 0, 0, 60, 40);
    return out.toDataURL("image/png");
  });
  expect(Buffer.from(url.split(",")[1], "base64")).toMatchSnapshot("render-box.png", { maxDiffPixelRatio: 0.02, threshold: 0.1 });
});
