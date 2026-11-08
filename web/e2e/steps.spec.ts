import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";

/** Reads a stored (uncompressed) zip's entries by their local headers. */
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (at + 30 <= bytes.length && v.getUint32(at, true) === 0x04034b50) {
    const size = v.getUint32(at + 18, true);
    const nameLen = v.getUint16(at + 26, true);
    const extra = v.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const start = at + 30 + nameLen + extra;
    out.set(name, bytes.subarray(start, start + size));
    at = start + size;
  }
  return out;
}

test("exports the bracket's build steps as pictures and a Markdown guide in a zip", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.showSaveFilePicker = async (o: { suggestedName: string }) => ({
      kind: "file",
      name: o.suggestedName,
      createWritable: async () => ({
        write: async (d: Blob) => {
          w.__steps = { name: o.suggestedName, bytes: [...new Uint8Array(await d.arrayBuffer())] };
        },
        close: async () => {},
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open the bracket sample" }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await page.getByRole("button", { name: "Share, versions and export" }).click();
  await page.getByRole("menuitem", { name: /^Build steps/ }).click();
  await expect(page.getByText(/^Exported \d+ steps to Bracket build steps\.zip$/)).toBeVisible({ timeout: 120_000 });

  const out = await page.evaluate(() => (window as unknown as { __steps: { name: string; bytes: number[] } }).__steps);
  expect(out.name).toBe("Bracket build steps.zip");
  const bytes = new Uint8Array(out.bytes);
  if (process.env.STEPS_OUT) writeFileSync(process.env.STEPS_OUT, bytes);
  const files = unzip(bytes);
  const md = new TextDecoder().decode(files.get("README.md"));
  expect(md).toContain("# How to build Bracket");
  expect(md).toContain("## Step 1: ");
  expect(files.has("Bracket.bcad")).toBe(true);
  const images = [...md.matchAll(/!\[[^\]]*\]\((images\/[^)]+)\)/g)].map((m) => m[1]!);
  expect(images.length).toBeGreaterThan(2);
  for (const img of images) {
    const png = files.get(img);
    expect(png, img).toBeDefined();
    expect([...png!.subarray(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
  }
});
