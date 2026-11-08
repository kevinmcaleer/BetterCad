import { expect, test, type Page } from "@playwright/test";
import { modelRow } from "./pages/editor";

/** A save draws a thumbnail and uploads it, which a busy CI runner can take well over the default 5 s to do. */
const SAVE = { timeout: 15_000 };

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

test("shows a save as a toast at the top right of the view, leaving the timeline where it is", async ({ page }) => {
  await mockPickers(page);
  await page.goto("/");
  await addBox(page);
  const timeline = page.getByRole("region", { name: "Timeline" });
  // Let the add's own status message clear, so only the save could move anything.
  await expect(page.locator(".bc-status-pill")).toBeHidden({ timeout: 8000 });
  // A busy machine can let a 3 s toast come and go between two looks, so note each one, and where things stood,
  // the moment it appears.
  await page.evaluate(() => {
    const w = window as unknown as { __toasts: { text: string; toast: DOMRect; timeline: DOMRect }[] };
    w.__toasts = [];
    const timeline = document.querySelector('[aria-label="Timeline"]')!;
    new MutationObserver(() => {
      for (const t of document.querySelectorAll(".bc-toast"))
        if (!w.__toasts.some((s) => s.text === t.textContent))
          w.__toasts.push({ text: t.textContent ?? "", toast: t.getBoundingClientRect().toJSON(), timeline: timeline.getBoundingClientRect().toJSON() });
    }).observe(document.body, { childList: true, subtree: true });
  });
  const before = await timeline.boundingBox();
  await page.keyboard.press("ControlOrMeta+s");
  type Seen = { text: string; toast: { x: number; y: number; width: number }; timeline: { x: number; y: number; width: number; height: number } };
  const seen = () => page.evaluate(() => (window as unknown as { __toasts: Seen[] }).__toasts.find((t) => t.text === "Saved to Bracket.bcad"));
  await expect.poll(seen, SAVE).toBeTruthy();
  const { toast: box, timeline: then } = (await seen())!;
  expect({ x: then.x, y: then.y, width: then.width, height: then.height }).toEqual(before);
  const props = (await page.locator(".bc-right").boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.y).toBeLessThan(view.height / 2);
  expect(box.x + box.width).toBeLessThanOrEqual(props.x);
  const toast = page.locator(".bc-toast");
  // It fades out on its own.
  await expect(toast).toBeHidden({ timeout: 5000 });
});

test("saves a .bcad in place, names the model after the file, and saves again without asking", { tag: "@journey" }, async ({ page }) => {
  await mockPickers(page);
  await page.goto("/");
  await addBox(page);
  await expect(page).toHaveTitle(/^• Untitled model/);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(modelRow(page)).toContainText("Bracket");
  await expect(page).toHaveTitle("Bracket · BetterCad", SAVE);
  const last = await page.evaluate(() => (window as unknown as { __writes: { text: string }[] }).__writes.at(-1)!.text);
  const file = JSON.parse(last);
  expect(file).toMatchObject({ schema: 2, app: "bettercad", name: "Bracket" });
  expect(file.document.features[0]).toMatchObject({ type: "add", name: "Box 1" });
  // A 320 × 200 thumbnail under 40 KB.
  expect(file.thumbnail).toMatch(/^data:image\/png;base64,/);
  expect((file.thumbnail.length * 3) / 4).toBeLessThan(40_000);

  // A change, then Save: straight to the same file.
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Cylinder", exact: true }).click();
  await expect(page).toHaveTitle(/^• Bracket/);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page).toHaveTitle("Bracket · BetterCad", SAVE);
  const calls = await page.evaluate(() => (window as unknown as { __calls: { save: number } }).__calls.save);
  expect(calls).toBe(1);
});

test("opens a saved file", async ({ page }) => {
  await mockPickers(page);
  await page.goto("/");
  await addBox(page);
  await page.keyboard.press("ControlOrMeta+s");
  // The save's toast is brief; the title says it's saved until the next change.
  await expect(page).toHaveTitle("Bracket · BetterCad", SAVE);
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
