import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Page objects for the end-to-end journeys (#107): the shell, the model toolbar, the 3D view, the Properties panel and
 * the Export dialog, so a spec reads like the person's steps.
 */
type View = { __bcView: { project(p: number[]): { x: number; y: number }; preset(p: string): void } };

export class Editor {
  constructor(readonly page: Page) {}

  async open(path = "/") {
    await this.page.goto(path);
    await expect(this.view.canvas).toBeVisible();
    return this;
  }

  /** The status line's latest message. */
  said(text: string | RegExp): Locator {
    return this.page.getByText(text);
  }

  /** Waits for the geometry engine, so the kernel's solids are in the view. */
  async kernelReady() {
    await expect(this.page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  }

  get view() {
    return new ViewPort(this.page);
  }
  get tools() {
    return this.page.getByRole("toolbar", { name: "Model tools" });
  }
  get sketchTools() {
    return this.page.getByRole("toolbar", { name: "Sketch tools" });
  }
  /** A number field by its label, with or without its unit ("Width" finds "Width (mm)"). */
  field(name: string): Locator {
    return this.page.getByRole("textbox", { name: new RegExp(`^${name}( \\(.+\\))?$`) });
  }
  get properties() {
    return new Properties(this.page);
  }
  async exportDialog() {
    await this.page.keyboard.press("ControlOrMeta+e");
    const d = new ExportDialog(this.page);
    await expect(d.root).toBeVisible();
    return d;
  }
  /** Picks a panel on the left rail: Parts, Library, Print… */
  async panel(name: string) {
    await this.page.getByRole("navigation").getByRole("button", { name, exact: true }).click();
  }
}

export class ViewPort {
  constructor(readonly page: Page) {}
  get canvas() {
    return this.page.getByTestId("view-canvas");
  }
  async preset(p: "top" | "iso" | "front") {
    await this.page.evaluate((x) => (window as unknown as View).__bcView.preset(x), p);
    await this.page.waitForTimeout(1200);
  }
  /** Where a world point is on the page, once the camera has stopped moving. */
  async at(x: number, y: number, z = 0) {
    const where = () => this.page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
    let q = await where();
    for (let i = 0; i < 40; i++) {
      await this.page.waitForTimeout(50);
      const r = await where();
      if (Math.abs(r.x - q.x) < 0.5 && Math.abs(r.y - q.y) < 0.5) break;
      q = r;
    }
    const box = (await this.canvas.boundingBox())!;
    return { x: box.x + q.x, y: box.y + q.y };
  }
  async hover(x: number, y: number, z = 0) {
    const p = await this.at(x, y, z);
    await this.page.mouse.move(p.x, p.y, { steps: 3 });
  }
  async click(x: number, y: number, z = 0) {
    await this.hover(x, y, z);
    await this.page.mouse.down();
    await this.page.mouse.up();
  }
  /** Clicks until `done` shows: the first click can land while the view is still settling. */
  async clickUntil(x: number, y: number, z: number, done: Locator) {
    await expect(async () => {
      if (!(await done.count())) await this.click(x, y, z);
      await expect(done).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15_000 });
  }
}

export class Properties {
  constructor(readonly page: Page) {}
  /** Selects a part in the browser, so Properties shows it. */
  async select(name: RegExp) {
    if (!(await this.page.getByRole("treeitem", { name }).count())) await this.page.getByRole("navigation").getByRole("button", { name: "Browser" }).click();
    await this.page.getByRole("treeitem", { name }).click();
  }
  value(text: string | RegExp) {
    return this.page.getByText(text).first();
  }
}

export class ExportDialog {
  constructor(readonly page: Page) {}
  get root() {
    return this.page.getByRole("dialog", { name: "Export" });
  }
  async resolution(name: "Draft" | "Normal" | "Fine") {
    await this.root.getByRole("button", { name }).click();
  }
  async export() {
    await this.root.getByRole("button", { name: "Export", exact: true }).click();
  }
}

/** Replaces the file pickers so saves and exports land in `window.__saved`, by file name. */
/** The body rows in the browser: the parts, leaving out the model, folders, planes and sketches. */
export function bodyRows(page: Page): Locator {
  return page.getByRole("tree", { name: "Browser" }).locator('[role="treeitem"][data-kind="body"]');
}

export async function catchSaves(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const saved: Record<string, number[]> = {};
    w.__saved = saved;
    w.showOpenFilePicker = async () => [];
    w.showSaveFilePicker = async (o: { suggestedName: string }) => ({
      kind: "file",
      name: o.suggestedName,
      createWritable: async () => ({
        write: async (d: Blob) => {
          saved[o.suggestedName] = [...new Uint8Array(await d.arrayBuffer())];
        },
        close: async () => {},
      }),
    });
  });
}

export async function savedFile(page: Page, name: string): Promise<Uint8Array> {
  const bytes = await page.evaluate((n) => (window as unknown as { __saved: Record<string, number[]> }).__saved[n], name);
  if (!bytes) throw new Error(`Nothing was saved as ${name}`);
  return new Uint8Array(bytes);
}
