import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/**
 * A real model whose chamfer broke twice (#425): a cog joined flat onto an octagonal wheel, chamfered 1 mm on its top
 * edge, moved before the pattern that copies it round the wheel. It opens with no failed steps, and the chamfer opened
 * from the timeline (which rolls the model back to it) still fits.
 */
type View = { __bcView: { bodyPositions(id: string): Float32Array | null } };

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "425-chamfer-cog-stud", "model.bcad");

test("a chamfer on a cog joined to a wheel builds, and still fits when you open it again", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(
    (text) => {
      const file = { kind: "file", name: "Cog.bcad", getFile: async () => new File([text], "Cog.bcad"), queryPermission: async () => "granted" };
      (window as unknown as Record<string, unknown>).showOpenFilePicker = async () => [file];
    },
    readFileSync(FILE, "utf8"),
  );
  const ed = await new Editor(page).open();
  await page.keyboard.press("ControlOrMeta+o");
  await expect(page.getByText("Opened Cog.bcad")).toBeVisible();
  await ed.kernelReady();

  // The wheel's mesh is on show once the whole model has built.
  await expect.poll(() => page.evaluate(() => !!(window as unknown as View).__bcView.bodyPositions("pmw8gysszf67")), { timeout: 90_000 }).toBe(true);

  const timeline = page.getByRole("region", { name: "Timeline" });
  const chamfer = timeline.getByRole("button", { name: /^Chamfer 2,/ });
  await expect(chamfer).toBeVisible({ timeout: 10_000 });
  // Every step built: none is marked with a problem.
  await expect(timeline.getByRole("button", { name: /problem:/ })).toHaveCount(0, { timeout: 60_000 });

  await chamfer.dblclick();
  await expect(page.getByRole("button", { name: "Chamfer", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(ed.field("Distance")).toHaveValue("1");
  // The live preview builds the chamfer where it sits in the timeline; give it time to say if it doesn't fit.
  await page.waitForTimeout(3000);
  await expect(page.getByText(/does not fit/)).toHaveCount(0);
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(timeline.getByRole("button", { name: /problem:/ })).toHaveCount(0, { timeout: 60_000 });
});
