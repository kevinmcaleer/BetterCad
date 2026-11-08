import { expect, test } from "@playwright/test";

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

  // The view bar's button opens it too.
  await page.getByRole("button", { name: "Render" }).click();
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
  // The picture has stopped at 4 samples, so one capture is enough: no waiting for two matching frames.
  const shot = await page.screenshot({ clip: { x: 300, y: 120, width: 300, height: 300 }, timeout: 120_000 });
  expect(shot).toMatchSnapshot("render-box.png", { maxDiffPixelRatio: 0.02 });
});
