import { expect, test } from "@playwright/test";

/** Colour and finish (#196): picked in Properties, shown in the view, carried into a GLB's materials. */
test("colours a box, gives it a finish and exports both to GLB", async ({ page }) => {
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
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });

  const colour = page.getByRole("group", { name: "Colour" });
  await colour.getByRole("button", { name: "Red" }).click();
  await expect(colour.getByRole("button", { name: "Red" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Matte PLA" }).click();
  await page.getByRole("menuitemradio", { name: "Glossy PETG" }).click();
  await expect(page.getByRole("button", { name: "Glossy PETG" })).toBeVisible();

  await page.keyboard.press("ControlOrMeta+e");
  const dialog = page.getByRole("dialog", { name: "Export" });
  await dialog.getByRole("button", { name: "GLB" }).click();
  await expect(dialog.getByText(/triangles/)).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const material = await page.evaluate(() => {
    const out = (window as unknown as { __export: { name: string; bytes: number[] } }).__export;
    const data = new Uint8Array(out.bytes);
    const v = new DataView(data.buffer);
    const len = v.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + len))) as {
      materials: { pbrMetallicRoughness: { baseColorFactor: number[]; roughnessFactor: number } }[];
    };
    return { name: out.name, pbr: json.materials[0]!.pbrMetallicRoughness };
  });
  expect(material.name).toMatch(/\.glb$/);
  expect(material.pbr.roughnessFactor).toBe(0.25);
  expect(material.pbr.baseColorFactor[0]).toBeGreaterThan(0.6);
  expect(material.pbr.baseColorFactor[1]).toBeLessThan(0.1);
});
