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
  await expect(bar.getByRole("status")).toHaveText("2 samples", { timeout: 120_000 });

  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole("img", { name: /Rendered picture/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pick: Bodies" })).toBeVisible();

  // The view style menu opens it too, in paper white.
  await page.getByRole("button", { name: /^(Shaded|Line art)$/ }).click();
  await page.getByRole("menuitem", { name: "Render in paper" }).click();
  await expect(bar.getByRole("button", { name: "Paper" })).toHaveAttribute("aria-pressed", "true");
  // A software GPU (CI) takes a while to build the path tracer's shader; wait for it before pressing Done.
  await expect(bar.getByRole("status")).toHaveText("2 samples", { timeout: 120_000 });
  await bar.getByRole("button", { name: "Done" }).click();
  await expect(bar).toHaveCount(0);
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
  await expect(page.getByRole("group", { name: "Render options" }).getByRole("status")).toHaveText("4 samples", { timeout: 200_000 });
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
