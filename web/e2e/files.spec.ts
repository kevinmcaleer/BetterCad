import { expect, test, type Page } from "@playwright/test";
import { modelRow } from "./pages/editor";

/** Stands in for Chrome's file pickers: files live in `window.__files`, and every write is recorded. */
async function mockPickers(page: Page, saveAs = "Bracket.bcad") {
  await page.addInitScript((name) => {
    const w = window as unknown as Record<string, unknown>;
    const files: Record<string, string> = {};
    const writes: { name: string; text: string }[] = [];
    const calls = { save: 0, open: 0 };
    const handle = (n: string) => ({
      kind: "file",
      name: n,
      getFile: async () => new File([files[n] ?? ""], n),
      createWritable: async () => {
        let text = "";
        return {
          write: async (d: Blob | string) => {
            text += typeof d === "string" ? d : await d.text();
          },
          close: async () => {
            files[n] = text;
            writes.push({ name: n, text });
          },
        };
      },
      queryPermission: async () => "granted",
    });
    w.__files = files;
    w.__writes = writes;
    w.__calls = calls;
    w.showSaveFilePicker = async () => {
      calls.save++;
      return handle(name);
    };
    w.showOpenFilePicker = async () => {
      calls.open++;
      return [handle(Object.keys(files)[0] ?? "Missing.bcad")];
    };
  }, saveAs);
}

const addBox = async (page: Page) => {
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: /Box 1/ })).toBeVisible();
};

test("saves a .bcad in place, names the model after the file, and saves again without asking", { tag: "@journey" }, async ({ page }) => {
  await mockPickers(page);
  await page.goto("/");
  await addBox(page);
  await expect(page).toHaveTitle(/^• Untitled model/);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved to Bracket.bcad")).toBeVisible();
  await expect(modelRow(page)).toContainText("Bracket");
  await expect(page).toHaveTitle("Bracket · BetterCad");
  const last = await page.evaluate(() => (window as unknown as { __writes: { text: string }[] }).__writes.at(-1)!.text);
  const file = JSON.parse(last);
  expect(file).toMatchObject({ schema: 1, app: "bettercad", name: "Bracket" });
  expect(file.document.features[0]).toMatchObject({ type: "add", name: "Box 1" });
  // A 320 × 200 thumbnail under 40 KB.
  expect(file.thumbnail).toMatch(/^data:image\/png;base64,/);
  expect((file.thumbnail.length * 3) / 4).toBeLessThan(40_000);

  // A change, then Save: straight to the same file.
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Cylinder", exact: true }).click();
  await expect(page).toHaveTitle(/^• Bracket/);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page).toHaveTitle("Bracket · BetterCad");
  const calls = await page.evaluate(() => (window as unknown as { __calls: { save: number } }).__calls.save);
  expect(calls).toBe(1);
});

test("opens a saved file", async ({ page }) => {
  await mockPickers(page);
  await page.goto("/");
  await addBox(page);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved to Bracket.bcad")).toBeVisible();
  // Start again, then open it back.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("menuitem", { name: /New model/ }).click();
  await expect(page.getByRole("treeitem", { name: /Box 1/ })).toHaveCount(0);
  // The fresh model's baseline lands a render after its document; Open before then would ask to save it.
  await expect(page).toHaveTitle("Untitled model · BetterCad");
  await page.keyboard.press("ControlOrMeta+o");
  await expect(page.getByText("Opened Bracket.bcad")).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /Box 1/ })).toBeVisible();
  await expect(modelRow(page)).toContainText("Bracket");
});

test("asks before a new model throws away unsaved changes", async ({ page }) => {
  await page.goto("/");
  await addBox(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("menuitem", { name: /New model/ }).click();
  const dialog = page.getByRole("dialog", { name: "Save changes to Untitled model?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Don't save" }).click();
  await expect(page.getByRole("treeitem", { name: /Box 1/ })).toHaveCount(0);
});

test("recovers an autosave after the tab closes", async ({ page }) => {
  await page.goto("/");
  await addBox(page);
  // Written to IndexedDB 3 seconds after the change.
  const saved = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const r = indexedDB.open("bettercad", 2);
          r.onsuccess = () => {
            const q = r.result.transaction("autosave").objectStore("autosave").count();
            q.onsuccess = () => resolve(q.result);
          };
          r.onerror = () => resolve(0);
        }),
    );
  await expect.poll(saved, { timeout: 10_000 }).toBe(1);
  await page.reload();
  const banner = page.getByText(/Recover ‘Untitled model’ from/);
  await expect(banner).toBeVisible();
  await page.getByRole("button", { name: "Recover", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: /Box 1/ })).toBeVisible();
  await expect(banner).toHaveCount(0);
});

test("downloads where the browser can't save in place", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });
  await page.goto("/");
  await addBox(page);
  const download = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+s");
  expect((await download).suggestedFilename()).toBe("Untitled model.bcad");
  await expect(page.getByText("Downloaded Untitled model.bcad. Your browser can't save in place.")).toBeVisible();
});
