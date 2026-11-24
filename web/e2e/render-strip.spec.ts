import { expect, test } from "@playwright/test";

// Close the page ourselves: SwiftShader can leave the context's own close waiting long enough to stall the next test.
test.afterEach(async ({ page }) => page.close());

/**
 * The Render view opens stopped: press Start. The path tracer's first look can freeze a software GPU's page while its
 * shader builds, so both steps wait long.
 */
async function startRender(page: import("@playwright/test").Page) {
  const bar = page.getByRole("group", { name: "Render options" });
  await expect(bar.getByRole("status")).toHaveText("Press Start to render", { timeout: 200_000 });
  await bar.getByRole("button", { name: "Start rendering" }).click({ timeout: 200_000 });
}

/** The render film strip: a shot added in the Render view renders in the background and lands on the strip. */
test("Add to strip renders the shot in the background, with a wheel on the top bar", async ({ page }) => {
  test.setTimeout(480_000);
  // The job itself makes a plain picture: a second path tracer would take minutes to build on SwiftShader.
  await page.addInitScript(() => Object.assign(window, { __bcRenderMax: 2, __bcFakeRenderJobs: true }));
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.getByRole("group", { name: "View cube" }).getByRole("button", { name: "Fit", exact: true }).waitFor();

  await page.keyboard.press("Shift+R");
  await startRender(page);
  const bar = page.getByRole("group", { name: "Render options" });
  // A software GPU freezes the page while the path tracer's shader builds: wait for the picture before anything else.
  await expect(bar.getByRole("status")).toHaveText("2 of 2 samples", { timeout: 240_000 });
  const strip = page.getByRole("region", { name: "Renders" });
  await strip.getByRole("button", { name: "Add to strip" }).click();
  // The wheel shows while the job runs; then it goes and the tile has its picture.
  await expect(page.getByRole("progressbar", { name: "Background renders" })).toBeVisible({ timeout: 60_000 });
  await expect(strip.getByRole("button", { name: "Render 1", exact: true })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("progressbar", { name: "Background renders" })).toHaveCount(0);
  await strip.getByRole("button", { name: "Render 1", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Render 1" });
  await expect(viewer.getByRole("img", { name: "Render of Render 1" })).toBeVisible();
  await expect(viewer.getByRole("checkbox", { name: "Update when I save" })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);

  // Back in modelling the timeline returns; the shot stays with the model.
  await bar.getByRole("button", { name: "Done" }).click();
  await expect(strip).toHaveCount(0);
});

/** Named views work in the Render view: a row moves the render's camera, a view saves from it, and goes on the strip. */
test("named views look from, save from and add shots in the Render view", async ({ page }) => {
  test.setTimeout(480_000);
  await page.addInitScript(() => Object.assign(window, { __bcRenderMax: 2, __bcFakeRenderJobs: true }));
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.getByRole("group", { name: "View cube" }).getByRole("button", { name: "Fit", exact: true }).waitFor();

  await page.keyboard.press("Shift+R");
  const bar = page.getByRole("group", { name: "Render options" });
  await expect(bar.getByRole("status")).toHaveText("Press Start to render", { timeout: 200_000 });
  const picture = page.getByRole("img", { name: /Rendered picture/ });
  await page.getByRole("button", { name: "Show what is in Named views" }).click();
  await page.getByRole("treeitem", { name: /^Top/ }).click();
  await expect(picture).toHaveAttribute("data-look", "-90 90");

  // Saved from the render's camera.
  await page.getByRole("tree").getByText("Named views", { exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Save this view/ }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("Hero");
  await page.keyboard.press("Enter");
  await page.getByRole("treeitem", { name: /^Front/ }).click();
  await expect(picture).toHaveAttribute("data-look", "-90 0");
  await page.getByRole("treeitem", { name: /^Hero/ }).click();
  await expect(picture).toHaveAttribute("data-look", "-90 90");

  // A shot on the strip, named after the view.
  await page.getByRole("treeitem", { name: /^Hero/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to the strip" }).click();
  const strip = page.getByRole("region", { name: "Renders" });
  await expect(strip.getByRole("button", { name: "Hero", exact: true })).toBeVisible({ timeout: 180_000 });
});
