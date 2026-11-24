import { expect, test, type Page } from "@playwright/test";
import { modelRow, openViewMenu } from "./pages/editor";
import { fakeApi } from "./fakeApi";

/** A save draws a thumbnail and uploads it, which a busy CI runner can take well over the default 5 s to do. */
const SAVE = { timeout: 15_000 };

/** Accounts, the library and saving to the cloud (#88, #89, #90) against the in-test server in fakeApi.ts. */

const addBox = async (page: Page) => {
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: /Box 1/ })).toBeVisible();
};

test("without a server the editor works and the account menu says so", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Account and settings" }).click();
  await expect(page.getByRole("menuitem", { name: "Accounts can't be reached here" })).toBeVisible();
});

test("sign in with kevsrobots.com, see the empty library, open the account page and sign out", async ({ page, context }) => {
  await fakeApi(context);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("menuitem", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByRole("link", { name: "Make an account" }).click();
  await expect(page.getByRole("heading", { name: "Make an account" })).toBeVisible();
  await page.getByRole("link", { name: "I have an account" }).click();
  // kevsrobots.com signs Kev in and sends the browser back to where sign-in started: the editor.
  await page.getByRole("button", { name: "Sign in with kevsrobots.com" }).click();
  await page.getByRole("button", { name: "Kev: account and settings" }).click();
  await page.getByRole("menuitem", { name: "My models" }).click();
  await expect(page.getByRole("heading", { name: "My models" })).toBeVisible();
  await expect(page.getByText("No models yet")).toBeVisible();
  await expect(page.getByText("0 models · 0 MB of 500 MB")).toBeVisible();
  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByText("Signed in to kevsrobots.com as Kev")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("save a box to the account, open it again from the library after a reload", { tag: "@journey" }, async ({ page, context }) => {
  const server = await fakeApi(context);
  await server.signIn(context);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Kev: account and settings" })).toBeVisible();
  await addBox(page);
  await page.getByRole("button", { name: "Share, versions and export" }).click();
  await page.getByRole("menuitem", { name: "Save to your account…" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Bracket");
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  await expect(page).toHaveURL(/#\/edit\/m\d+$/, SAVE);
  await expect(page.getByRole("button", { name: "Save", exact: true }).first()).toHaveAccessibleDescription("Saved to your account", SAVE);
  const [model] = [...server.models.values()];
  expect(JSON.parse(model!.versions[0]!.bcad).document.features[0]).toMatchObject({ type: "add" });

  // Ctrl+S saves the next version to the account, not to disk.
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Cylinder", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => model!.versions.length, SAVE).toBe(2);

  await page.goto("/#/library");
  await page.reload();
  // The card shows the picture saved with the model, not the placeholder cube.
  const thumb = page.getByRole("button", { name: "Open Bracket" }).locator("img");
  await expect(thumb).toBeVisible();
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(320);
  await expect(thumb).not.toHaveClass(/bc-thumb-pending/);
  // Under the name: the space both versions take.
  const size = model!.versions.reduce((n, v) => n + v.bcad.length, 0);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Open Bracket" }) });
  await expect(card.getByTitle("across 2 versions")).toHaveText(size >= 1024 * 1024 ? /MB$/ : `${Math.max(1, Math.round(size / 1024))} KB`);
  await page.getByRole("button", { name: "Open Bracket" }).click();
  await expect(modelRow(page)).toContainText("Bracket");
  await expect(page.getByRole("treeitem", { name: /Box 1/ })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /Cylinder 1/ })).toBeVisible();
});

test("a project's card shows its models, and one opens straight from My models", async ({ page, context }) => {
  const server = await fakeApi(context);
  await server.signIn(context);
  await page.goto("/#/library");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill("Rover");
  await page.getByRole("button", { name: "Make" }).click();
  await expect(page).toHaveURL(/#\/library\/project\//);
  await page.getByRole("button", { name: "New model" }).first().click();
  await expect(page).toHaveURL(/#\/edit\//);
  const id = page.url().split("/edit/")[1];
  await page.goto("/#/library");
  const peek = page.getByRole("list", { name: "Models in Rover" });
  await expect(peek.getByRole("link", { name: /Untitled model/ })).toBeVisible();
  if (process.env.PEEK_SHOT) await page.screenshot({ path: process.env.PEEK_SHOT });
  await peek.getByRole("link", { name: /Untitled model/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/edit/${id}$`));
});

test("rename, duplicate, delete and restore in the library", async ({ page, context }) => {
  const server = await fakeApi(context);
  await server.signIn(context);
  await page.goto("/#/library");
  await page.getByRole("button", { name: "New model" }).first().click();
  await expect(page).toHaveURL(/#\/edit\//);
  await page.goto("/#/library");
  await page.getByRole("button", { name: "More for Untitled model" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "New name" }).fill("Gear");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Renamed to Gear")).toBeVisible();
  await page.getByRole("button", { name: "More for Gear" }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page.getByRole("button", { name: "Open Gear copy" })).toBeVisible();
  await page.getByRole("button", { name: "More for Gear copy" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Moved Gear copy to the bin")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Gear copy" })).toHaveCount(0);
  await page.getByRole("button", { name: "Bin" }).click();
  await page.getByRole("button", { name: "More for Gear copy" }).click();
  await page.getByRole("menuitem", { name: "Restore" }).click();
  await expect(page.getByText("The bin is empty.")).toBeVisible();
  await page.getByRole("button", { name: "Back to my models" }).click();
  await expect(page.getByRole("button", { name: "Open Gear copy" })).toBeVisible();
  await page.getByLabel("Search by name").fill("copy");
  await expect(page.getByRole("button", { name: /^Open Gear/ })).toHaveCount(1);
});

test("make a folder, move a model into it and find it by search", async ({ page, context }) => {
  const server = await fakeApi(context);
  await server.signIn(context);
  await page.goto("/#/library");
  await page.getByRole("button", { name: "New model" }).first().click();
  await expect(page).toHaveURL(/#\/edit\//);
  await page.goto("/#/library");
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Wheels");
  await page.getByRole("button", { name: "Make" }).click();
  await expect(page.getByRole("button", { name: "Open folder Wheels" })).toBeVisible();

  await page.getByRole("button", { name: "More for Untitled model" }).click();
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  await page
    .getByRole("dialog", { name: "Move Untitled model" })
    .getByRole("radio", { name: /Wheels/ })
    .check();
  await page.getByRole("button", { name: "Move here" }).click();
  await expect(page.getByText("Moved Untitled model to Wheels")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Untitled model" })).toHaveCount(0);

  await page.getByRole("button", { name: "Open folder Wheels" }).click();
  await expect(page).toHaveURL(/#\/library\/folder\/f\d+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Wheels" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Untitled model" })).toBeVisible();
  await page.getByRole("navigation", { name: "Breadcrumbs" }).getByRole("link", { name: "My models" }).click();
  await page.getByLabel("Search by name").fill("untitled");
  await expect(page.getByRole("list", { name: "Search results" }).getByText("Wheels")).toBeVisible();
});

test("a save from a second tab warns about the first", async ({ page, context }) => {
  const server = await fakeApi(context);
  await server.signIn(context);
  await page.goto("/");
  await addBox(page);
  await page.getByRole("button", { name: "Share, versions and export" }).click();
  await page.getByRole("menuitem", { name: "Save to your account…" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  await expect(page).toHaveURL(/#\/edit\/m\d+$/, SAVE);
  const url = page.url();

  const other = await context.newPage();
  await other.goto(url);
  await expect(other.getByRole("treeitem", { name: /Box 1/ })).toBeVisible();
  await other.getByRole("button", { name: "Library" }).click();
  await other.getByRole("button", { name: "Sphere", exact: true }).click();
  await other.keyboard.press("ControlOrMeta+s");
  await expect(other.getByRole("button", { name: "Save", exact: true }).first()).toHaveAccessibleDescription("Saved to your account", SAVE);

  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Cone", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("dialog", { name: "This model changed in another tab" })).toBeVisible();
  await page.getByRole("button", { name: "Save anyway" }).click();
  // The toast fades after 3 s, and a busy CI runner can draw the save's thumbnail for longer; the Save button
  // is described as "Saved to your account" until the next change.
  await expect(page.getByRole("button", { name: "Save", exact: true }).first()).toHaveAccessibleDescription("Saved to your account", SAVE);
  const [model] = [...server.models.values()];
  expect(model!.versions.length).toBe(3);
});

test("offline saves wait in the browser and go when the network is back", async ({ page, context }) => {
  const server = await fakeApi(context);
  await server.signIn(context);
  await page.goto("/");
  await addBox(page);
  await page.getByRole("button", { name: "Share, versions and export" }).click();
  await page.getByRole("menuitem", { name: "Save to your account…" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Bracket");
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  // The save's toast is brief and an Autosaved toast can replace it, so check the server got it.
  await expect.poll(() => [...server.models.values()].map((m) => m.versions.length), SAVE).toEqual([1]);
  // The server has it a moment before the editor takes the model's address; leave only once it has.
  await expect(page).toHaveURL(/#\/edit\/m\d+$/, SAVE);
  // One look at the library while online, so it has a list to show later.
  await page.goto(page.url().replace(/#.*/, "#/library"));
  await expect(page.getByRole("button", { name: "Open Bracket" })).toBeVisible();
  await page.getByRole("button", { name: "Open Bracket" }).click();
  await expect(page.getByRole("treeitem", { name: /Box 1/ })).toBeVisible();

  server.down = true;
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Cylinder", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+s");
  // The browser still says it's online, so this reads as the server not answering, not as being offline.
  await expect(
    page.getByText("BetterCad\u2019s server can\u2019t be reached just now. Your connection looks fine. This save waits and goes when it's back."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveAccessibleDescription("Server not answering: saves when it's back");

  // The library shows the last list it saw.
  await page.goto("/#/library");
  await expect(page.getByText(/Showing your last synced models/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Bracket" })).toBeVisible();

  server.down = false;
  await page.goto("/");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => [...server.models.values()][0]!.versions.length, SAVE).toBe(2);
  const latest = JSON.parse([...server.models.values()][0]!.versions[1]!.bcad);
  expect(latest.document.features.map((f: { name: string }) => f.name)).toEqual(["Box 1", "Cylinder 1"]);
});

test("a thumbnail is shaded in light colours whatever the theme and view style", async ({ page, context }) => {
  const server = await fakeApi(context);
  await server.signIn(context);
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("bettercad.theme", "holoroom"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "holoroom");
  await addBox(page);
  // Holoroom may already draw line art; choose it either way.
  await openViewMenu(page);
  await page.getByRole("menuitemradio", { name: "Line art" }).click();
  await expect(page.getByRole("application", { name: /3D view/ })).toHaveAttribute("data-style", "lineart");
  await page.getByRole("button", { name: "Share, versions and export" }).click();
  await page.getByRole("menuitem", { name: "Save to your account…" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Bracket");
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  // The toast fades after 3 s, and a busy CI runner can draw the save's thumbnail for longer; the Save button
  // is described as "Saved to your account" until the next change.
  await expect(page.getByRole("button", { name: "Save", exact: true }).first()).toHaveAccessibleDescription("Saved to your account", SAVE);
  const [model] = [...server.models.values()];
  const thumb = JSON.parse(model!.versions[0]!.bcad).thumbnail as string;
  // The mean brightness of the drawn pixels: Holoroom's line art fill is near black, a Light shaded box is pale.
  const mean = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! < 200) continue;
      sum += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      n++;
    }
    return n > 500 ? sum / n : 0;
  }, thumb);
  expect(mean).toBeGreaterThan(120);
  // The view keeps its own style.
  await expect(page.getByRole("application", { name: /3D view/ })).toHaveAttribute("data-style", "lineart");
});

test("a thumbnail has the view's colours", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await addBox(page);
  await page.keyboard.press("Escape");
  await page.mouse.move(1, 1);
  await page.waitForTimeout(500);
  const canvas = page.getByTestId("view-canvas");
  const size = (await canvas.boundingBox())!;
  const shot = (await canvas.screenshot()).toString("base64");
  // Drawn at the view's own size, so each body pixel sits where it does on screen.
  const diff = await page.evaluate(
    async ({ shot, w, h }) => {
      const view = (window as unknown as { __bcView: { thumbnail(w: number, h: number): string | null } }).__bcView;
      const pixels = async (src: string) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0, w, h);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const t = await pixels(view.thumbnail(w, h)!);
      const v = await pixels(`data:image/png;base64,${shot}`);
      let thumb = 0;
      let screen = 0;
      let n = 0;
      for (let i = 0; i < t.length; i += 4) {
        if (t[i + 3]! < 255) continue;
        thumb += t[i]! + t[i + 1]! + t[i + 2]!;
        screen += v[i]! + v[i + 1]! + v[i + 2]!;
        n++;
      }
      return n > 500 ? Math.abs(thumb - screen) / (n * 3) : 999;
    },
    { shot, w: Math.round(size.width), h: Math.round(size.height) },
  );
  // Linear pixels read back about 35 levels darker on a pale box.
  expect(diff).toBeLessThan(12);
});

test("after a save to the account, a rendered picture replaces the thumbnail", async ({ page, context }) => {
  // The path tracer on a software GPU (CI) takes a while to build its shader.
  test.setTimeout(270_000);
  const server = await fakeApi(context);
  await server.signIn(context);
  // One sample, and all the time the software GPU needs, rather than giving up after 20 s as a real browser would.
  await page.addInitScript(() => ((window as unknown as { __bcRenderThumbs: object }).__bcRenderThumbs = { samples: 1, timeout: 200_000 }));
  await page.goto("/");
  await addBox(page);
  await page.getByRole("button", { name: "Share, versions and export" }).click();
  await page.getByRole("menuitem", { name: "Save to your account…" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Bracket");
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  // The save doesn't wait for the render: it lands with the shaded PNG first. A loaded runner takes more than the
  // default 5 s to shade the thumbnail and send it.
  await expect.poll(() => server.models.size, { timeout: 30_000 }).toBe(1);
  const [model] = [...server.models.values()];
  expect(JSON.parse(model!.versions[0]!.bcad).thumbnail).toMatch(/^data:image\/png;base64,/);
  await expect.poll(() => model!.versions[0]!.thumbnail ?? "", { timeout: 220_000 }).toMatch(/^data:image\/jpeg;base64,/);
  // A lit box on a pale floor: mostly light, and not one flat colour.
  const stats = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    let min = 255;
    let max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      sum += l;
      min = Math.min(min, l);
      max = Math.max(max, l);
    }
    return { w: c.width, h: c.height, mean: sum / (d.length / 4), range: max - min };
  }, model!.versions[0]!.thumbnail!);
  expect(stats).toMatchObject({ w: 320, h: 200 });
  expect(stats.mean).toBeGreaterThan(100);
  expect(stats.range).toBeGreaterThan(40);
  // The library shows the rendered picture.
  await page.goto("/#/library");
  const thumb = page.getByRole("button", { name: "Open Bracket" }).locator("img");
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(320);
});

test("upload STL files into a project, each as a model that opens with its body", async ({ page, context }) => {
  const server = await fakeApi(context);
  await server.signIn(context);
  await page.goto("/#/library");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill("Rover");
  await page.getByRole("button", { name: "Make" }).click();
  await expect(page).toHaveURL(/#\/library\/project\//);
  const tri = (z: number) => `facet normal 0 0 1\n outer loop\n  vertex 0 0 ${z}\n  vertex 10 0 ${z}\n  vertex 0 10 ${z}\n endloop\nendfacet\n`;
  const stl = (name: string) => ({ name, mimeType: "model/stl", buffer: Buffer.from(`solid ${name}\n${tri(0)}${tri(5)}endsolid ${name}\n`) });
  await page.getByLabel("Files to upload").setInputFiles([stl("Wheel hub.stl"), stl("Tyre.stl")]);
  await expect(page.getByText("Uploaded 2 models")).toBeVisible(SAVE);
  expect([...server.models.values()].map((m) => m.name).sort()).toEqual(["Tyre", "Wheel hub"]);
  expect(server.blobs.size).toBe(2);
  await page.getByRole("button", { name: "Open Tyre" }).click();
  await expect(page).toHaveURL(/#\/edit\//);
  await expect(page.getByRole("treeitem", { name: /Tyre/ }).first()).toBeVisible({ timeout: 30_000 });
});

test("upload a .bcad and a STEP file, each saved as a model that opens", async ({ page, context }) => {
  test.setTimeout(120_000);
  const server = await fakeApi(context);
  await server.signIn(context);
  await page.goto("/#/library");
  await expect(page.getByRole("button", { name: "Upload" })).toBeVisible();
  const root = new URL("../../", import.meta.url).pathname;
  await page
    .getByLabel("Files to upload")
    .setInputFiles([`${root}web/public/samples/bracket.bcad`, `${root}packages/kernel/src/testdata/step/cog-on-flat.step`]);
  // The STEP file waits for the geometry engine to read its solids; the upload card shows how far each file has got.
  const card = page.getByRole("region", { name: "Uploads" });
  await expect(card.getByText("bracket.bcad")).toBeVisible();
  await expect(page.getByText("Uploaded 2 models")).toBeVisible({ timeout: 90_000 });
  await expect(card).toContainText("Saved as cog-on-flat");
  const names = [...server.models.values()].map((m) => m.name);
  expect(names).toContain("cog-on-flat");
  expect(names).toHaveLength(2);
  await page.getByRole("button", { name: "Open cog-on-flat" }).click();
  await expect(page).toHaveURL(/#\/edit\//);
  await expect(
    page
      .getByRole("treeitem", { name: /Import/ })
      .or(page.getByRole("treeitem", { name: /cog/i }))
      .first(),
  ).toBeVisible({ timeout: 60_000 });
});

test("right-click a model, then pick several and move or bin them together", async ({ page, context }) => {
  const server = await fakeApi(context);
  await server.signIn(context);
  await page.goto("/#/library");
  const stl = (name: string) => ({
    name: `${name}.stl`,
    mimeType: "model/stl",
    buffer: Buffer.from(`solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid t\n`),
  });
  await page.getByLabel("Files to upload").setInputFiles(["Wheel", "Axle", "Hub", "Motor"].map(stl));
  await expect(page.getByText("Uploaded 4 models")).toBeVisible(SAVE);
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Drive");
  await page.getByRole("button", { name: "Make" }).click();
  await expect(page.getByRole("button", { name: "Open folder Drive" })).toBeVisible();

  await page.getByRole("button", { name: "Open Wheel" }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Wheel menu" });
  await expect(menu.getByRole("menuitem", { name: "Rename" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "New name" }).fill("Front wheel");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Renamed to Front wheel")).toBeVisible();

  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.getByRole("button", { name: "Open Axle" }).click({ modifiers: [mod] });
  await page.getByRole("button", { name: "Open Motor" }).click({ modifiers: [mod] });
  const bar = page.getByRole("toolbar", { name: "Selected models" });
  await expect(bar).toContainText("2 selected");
  if (process.env.PICK_SHOT) await page.screenshot({ path: process.env.PICK_SHOT });
  await bar.getByRole("button", { name: "Move to…" }).click();
  await page.getByRole("dialog", { name: "Move 2 models" }).getByRole("radio", { name: /Drive/ }).check();
  await page.getByRole("button", { name: "Move here" }).click();
  await expect(page.getByText("Moved 2 models to Drive")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Axle" })).toHaveCount(0);
  await expect(bar).toHaveCount(0);

  await page.getByRole("checkbox", { name: "Select Hub" }).check();
  await page.getByRole("checkbox", { name: "Select Front wheel" }).check();
  await page.getByRole("button", { name: "Open Hub" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete 2 models…" }).click();
  await page.getByRole("dialog", { name: "Delete 2 models?" }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Moved 2 models to the bin")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Hub" })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Restored 2 models")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Hub" })).toBeVisible();
});
