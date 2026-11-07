import { expect, test, type Page } from "@playwright/test";

const triangles = async (page: Page) => {
  const status = page.getByRole("dialog", { name: "Export" }).getByRole("status").filter({ hasText: "triangles" });
  await expect(status).toBeVisible({ timeout: 60_000 });
  return Number((await status.textContent())!.match(/≈ ([\d,]+) triangles/)![1]!.replace(/,/g, ""));
};

test("exports a sphere as STL at the chosen resolution, from the kernel", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.showOpenFilePicker = async () => [];
    w.showSaveFilePicker = async (o: { suggestedName: string }) => ({
      kind: "file",
      name: o.suggestedName,
      createWritable: async () => ({
        write: async (d: Blob) => {
          w.__export = { name: o.suggestedName, bytes: [...new Uint8Array(await d.arrayBuffer())] };
        },
        close: async () => {},
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Sphere", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.getByRole("textbox", { name: "Model name" }).fill("Ball");
  await page.getByRole("textbox", { name: "Model name" }).press("Enter");

  await page.keyboard.press("ControlOrMeta+e");
  const dialog = page.getByRole("dialog", { name: "Export" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Draft" }).click();
  const draft = await triangles(page);
  await dialog.getByRole("button", { name: "Fine" }).click();
  await expect(dialog.getByText("Within 0.005 mm of the true surface")).toBeVisible();
  const fine = await triangles(page);
  expect(fine).toBeGreaterThan(draft);

  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByText("Exported Ball.stl")).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toHaveCount(0);
  const out = await page.evaluate(() => (window as unknown as { __export: { name: string; bytes: number[] } }).__export);
  expect(out.name).toBe("Ball.stl");
  const bytes = new Uint8Array(out.bytes);
  expect(new TextDecoder().decode(bytes.subarray(0, 14))).toBe("BetterCad Ball");
  const count = new DataView(bytes.buffer).getUint32(80, true);
  expect(count).toBe(fine);
  expect(bytes.length).toBe(84 + 50 * count);
});

test("STEP shows the solid count instead of a resolution, and downloads where it can't save in place", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("menuitem", { name: /Export STL, 3MF or STEP/ }).click();
  const dialog = page.getByRole("dialog", { name: "Export" });
  await dialog.getByRole("button", { name: "STEP" }).click();
  await expect(dialog.getByRole("group", { name: "Resolution" })).toHaveCount(0);
  await expect(dialog.getByText("1 solid, exact")).toBeVisible({ timeout: 60_000 });
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("Untitled model.step");
});
