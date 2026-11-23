import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** New drawing from the view menu, on the page size given. */
async function newDrawing(page: Page, size: string) {
  // The view style button is named for the style: Shaded, or Line art in Holoroom.
  await page.getByRole("button", { name: /^(Shaded|Line art)$/ }).click();
  await page.getByRole("menuitem", { name: "New drawing" }).click();
  const card = page.getByRole("dialog", { name: "New drawing" });
  await card.getByLabel("Page size").selectOption(size);
  await card.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("region", { name: "Drawing: Drawing 1" })).toBeVisible();
}

/** The bracket sample with a new A3 drawing and its top view placed. */
async function topViewOnA3(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open the bracket sample" }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await newDrawing(page, "A3");
  await page.keyboard.press("b");
  const base = page.getByRole("dialog", { name: "Base view" });
  await expect(base.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await base.getByLabel("Direction").selectOption({ label: "Top" });
  await expect(base.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await base.getByRole("button", { name: "Place" }).click();
  await expect(page.getByRole("button", { name: /^Top view, / }).locator(".bc-view-visible")).toHaveAttribute("d", /A/, { timeout: 30_000 });
}

/**
 * Pins the room the sheet is fitted in, then fits it, so a picture's size does not change when the bars around the
 * view gain a button or a row.
 */
async function steady(page: Page) {
  await page.addStyleTag({ content: ".bc-drawing-clear{inset:70px 320px 240px 320px !important}" });
  await page.keyboard.press("f");
}

/** Where the page sat over half a second of frames, with the height its bar said it had: one entry once it has settled. */
const sheetBoxes = (page: Page) =>
  page.evaluate(async () => {
    const paper = document.querySelector(".bc-sheet-paper")!;
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      await new Promise(requestAnimationFrame);
      const b = paper.getBoundingClientRect();
      seen.add(
        [b.x, b.y, b.width, b.height].map((n) => n.toFixed(1)).join(" ") + " bar " + document.documentElement.style.getPropertyValue("--bc-drawing-bar"),
      );
    }
    return [...seen];
  });

/** Drawings (#555): a sheet in place of the 3D view, with its title block, kept in the model. */
test("make a drawing, fill in its title block, leave it and open it again", { tag: "@journey" }, async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Pick: Bodies" }).waitFor();
  await newDrawing(page, "A3");

  // The sheet takes the view: paper, with the title block bottom right, and the 3D view's bar gives way to its own.
  const sheet = page.getByRole("group", { name: "Sheet 1: A3, landscape" });
  await expect(sheet).toBeVisible();
  await expect(page.getByRole("button", { name: "Pick: Bodies" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "View cube" })).toBeHidden();
  const block = page.getByRole("group", { name: "Title block" });
  await expect(block.getByRole("button", { name: "Title: Untitled model" })).toBeVisible();
  await expect(block.getByRole("img", { name: "Size: A3" })).toBeVisible();
  await expect(block.getByRole("img", { name: "Projection: first angle" })).toBeVisible();
  const paper = (await sheet.locator(".bc-sheet-paper").boundingBox())!;
  const corner = (await block.boundingBox())!;
  expect(corner.x + corner.width).toBeLessThanOrEqual(paper.x + paper.width);
  expect(corner.y + corner.height).toBeLessThanOrEqual(paper.y + paper.height);
  expect(corner.x).toBeGreaterThan(paper.x + paper.width / 2);
  expect(corner.y).toBeGreaterThan(paper.y + paper.height / 2);

  // Double-click a field to type in it, by mouse; Enter on a focused field, by keyboard.
  await block.getByRole("button", { name: "Drawing number: blank" }).dblclick();
  await page.getByRole("textbox", { name: "Drawing number" }).fill("BC-001");
  await page.keyboard.press("Enter");
  await expect(block.getByRole("button", { name: "Drawing number: BC-001" })).toBeVisible();
  await block.getByRole("button", { name: "Title: Untitled model" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Title" }).fill("Bracket");
  await page.keyboard.press("Enter");
  await expect(block.getByRole("button", { name: "Title: Bracket" })).toBeVisible();

  // The wheel zooms and F fits the sheet again.
  await page.mouse.move(paper.x + 100, paper.y + 100);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await sheet.locator(".bc-sheet-paper").boundingBox())!.width).toBeGreaterThan(paper.width * 1.2);
  await page.keyboard.press("f");
  await expect.poll(async () => Math.round((await sheet.locator(".bc-sheet-paper").boundingBox())!.width)).toBe(Math.round(paper.width));

  // Sheet settings turns the page and switches the standard.
  await page.getByRole("button", { name: "Sheet settings" }).click();
  const settings = page.getByRole("dialog", { name: "Sheet settings" });
  await expect(settings.getByRole("textbox", { name: "Drawing number" })).toHaveValue("BC-001");
  await settings.getByRole("button", { name: "Portrait" }).click();
  await settings.getByLabel("Standard").selectOption("asme");
  await settings.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("group", { name: "Sheet 1: A3, portrait" })).toBeVisible();
  await expect(block.getByRole("img", { name: "Projection: third angle" })).toBeVisible();

  // Esc goes back to the model; the drawing is in the browser, and a double-click opens it as it was left.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Drawing: Drawing 1" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pick: Bodies" })).toBeVisible();
  await page.getByRole("treeitem", { name: /^Drawing 1/ }).dblclick();
  await expect(page.getByRole("group", { name: "Sheet 1: A3, portrait" })).toBeVisible();
  await expect(block.getByRole("button", { name: "Title: Bracket" })).toBeVisible();
  await page.getByRole("button", { name: "Finish drawing" }).click();
  await expect(page.getByRole("region", { name: "Drawing: Drawing 1" })).toHaveCount(0);

  // Undo steps back through the drawing's changes like any others, down to there being no drawing.
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("treeitem", { name: /^Drawing 1/ })).toHaveCount(0);
});

/** Base view (#561): the model's lines on the sheet, from the real kernel. */
test("place a base view of the bracket, move it, change it and delete it", { tag: "@journey" }, async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open the bracket sample" }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await newDrawing(page, "A3");
  const paper = (await page.locator(".bc-sheet-paper").boundingBox())!;

  // B arms Base view: its card opens, and the view follows the pointer until a click puts it down.
  await page.keyboard.press("b");
  const card = page.getByRole("dialog", { name: "Base view" });
  await expect(card.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await expect(card.getByLabel("Scale")).toContainText("Fit, 2:1");
  await page.mouse.move(paper.x + paper.width * 0.3, paper.y + paper.height * 0.4);
  await expect(page.locator(".bc-view-ghost path")).toHaveAttribute("d", /M/);
  await page.mouse.click(paper.x + paper.width * 0.3, paper.y + paper.height * 0.4);
  await expect(card).toHaveCount(0);
  const front = page.getByRole("button", { name: "Front view, 2:1" });
  await expect(front).toBeVisible({ timeout: 30_000 });
  // The bracket from the front is an L with its two holes behind, dashed; the title block takes the view's scale.
  await expect(front.locator(".bc-view-visible")).toHaveAttribute("d", /^(M[^M]+){6,}$/);
  await expect(front.locator(".bc-view-hidden")).toHaveAttribute("d", /M/);
  await expect(page.getByRole("img", { name: "Scale: 2:1" })).toBeVisible();
  const box = (await front.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - (paper.x + paper.width * 0.3))).toBeLessThan(3);

  // Drag it across the sheet.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await front.boundingBox())!.x - box.x)).toBe(120);

  // A second view by keyboard: an isometric, placed in the middle of the clear space with Enter.
  await page.keyboard.press("b");
  await card.getByLabel("Direction").selectOption({ label: "Isometric, front right" });
  await expect(card.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await card.getByLabel("Direction").press("Enter");
  const iso = page.getByRole("button", { name: /^Isometric view, / });
  await expect(iso).toBeVisible({ timeout: 30_000 });
  await expect(iso.locator(".bc-view-visible")).toHaveAttribute("d", /A/, { timeout: 30_000 });

  // Double-click changes a view; Delete takes it away; the drawing keeps its views when you leave and come back.
  await iso.dblclick();
  await card.getByLabel("Direction").selectOption({ label: "Top" });
  await card.getByRole("button", { name: "Done" }).click();
  const top = page.getByRole("button", { name: /^Top view, / });
  await expect(top).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Drawing: Drawing 1" })).toHaveCount(0);
  await page.getByRole("treeitem", { name: /^Drawing 1/ }).dblclick();
  await expect(top).toBeVisible({ timeout: 30_000 });
  await expect(front).toBeVisible();
  await top.focus();
  await page.keyboard.press("Delete");
  await expect(top).toHaveCount(0);
  await expect(front).toBeVisible();
});

test("project top and side views from a front view; they stay lined up and follow the standard", { tag: "@journey" }, async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open the bracket sample" }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await newDrawing(page, "A3");
  await page.keyboard.press("b");
  const base = page.getByRole("dialog", { name: "Base view" });
  await expect(base.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await base.getByLabel("Scale").selectOption({ label: "1:1" });
  await base.getByRole("button", { name: "Place" }).click();
  const front = page.getByRole("button", { name: "Front view, 1:1" });
  await expect(front.locator(".bc-view-visible")).toHaveAttribute("d", /M/, { timeout: 30_000 });
  const mid = async (l: typeof front) => {
    const b = (await l.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const f = await mid(front);

  // P arms Projected view from the view that is selected. A3 is first angle: below is the top view, left the right.
  await page.keyboard.press("p");
  const card = page.getByRole("dialog", { name: "Projected view" });
  await expect(card.getByLabel("From")).toHaveValue(/.+/);
  await page.mouse.move(f.x + 6, f.y + 150);
  await expect(card.getByLabel("Side")).toHaveValue("below");
  await expect(card.getByRole("status")).toHaveText(/Move the pointer away/, { timeout: 30_000 });
  await expect(page.locator(".bc-view-ghost path")).toHaveAttribute("d", /M/);
  await page.mouse.click(f.x + 6, f.y + 150);
  const top = page.getByRole("button", { name: "Top view, 1:1" });
  await expect(top.locator(".bc-view-visible")).toHaveAttribute("d", /A/, { timeout: 30_000 });
  await page.mouse.move(f.x - 180, f.y - 8);
  await expect(card.getByLabel("Side")).toHaveValue("left");
  await expect(card.getByRole("status")).toHaveText(/Move the pointer away/, { timeout: 30_000 });
  await page.mouse.click(f.x - 180, f.y - 8);
  const right = page.getByRole("button", { name: "Right view, 1:1" });
  await expect(right.locator(".bc-view-visible")).toHaveAttribute("d", /M/, { timeout: 30_000 });
  await page.keyboard.press("Enter");
  await expect(card).toHaveCount(0);
  // In line with the front view, whatever the pointer was off by.
  expect(Math.abs((await mid(top)).x - f.x)).toBeLessThan(1.5);
  expect((await mid(top)).y).toBeGreaterThan(f.y + 100);
  expect(Math.abs((await mid(right)).y - f.y)).toBeLessThan(1.5);
  expect((await mid(right)).x).toBeLessThan(f.x - 100);

  // The top view slides along its line only, and dragging the front view carries both.
  const t = await mid(top);
  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  await page.mouse.move(t.x + 60, t.y + 20, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await mid(top)).y - t.y)).toBe(20);
  expect(Math.abs((await mid(top)).x - f.x)).toBeLessThan(1.5);
  await page.mouse.move(f.x, f.y);
  await page.mouse.down();
  await page.mouse.move(f.x + 40, f.y - 30, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await mid(front)).x - f.x)).toBe(40);
  expect(Math.abs((await mid(top)).x - (f.x + 40))).toBeLessThan(1.5);
  expect(Math.abs((await mid(right)).y - (f.y - 30))).toBeLessThan(1.5);

  // Third angle swaps them over: the top view goes above the front, the right view to its right.
  await page.getByRole("button", { name: "Sheet settings" }).first().click();
  const settings = page.getByRole("dialog", { name: "Sheet settings" });
  await settings.getByLabel("Standard").selectOption("asme");
  await settings.getByRole("button", { name: "Done" }).click();
  await expect.poll(async () => (await mid(top)).y < (await mid(front)).y).toBe(true);
  expect((await mid(right)).x).toBeGreaterThan((await mid(front)).x);

  // Deleting the front view asks first, and keeps the others.
  await front.focus();
  await page.keyboard.press("Delete");
  await page.getByRole("dialog", { name: "Delete this view?" }).getByRole("button", { name: "Delete" }).click();
  await expect(front).toHaveCount(0);
  await expect(top).toBeVisible();
  await expect(right).toBeVisible();
});

test("export a drawing as PDF, SVG, DXF and PNG", { tag: "@journey" }, async ({ page }) => {
  // No save picker here, so each file comes as a download.
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open the bracket sample" }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await newDrawing(page, "A4");
  await page.keyboard.press("b");
  const base = page.getByRole("dialog", { name: "Base view" });
  await expect(base.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await base.getByRole("button", { name: "Place" }).click();
  await expect(page.getByRole("button", { name: /^Front view, / }).locator(".bc-view-hidden")).toHaveAttribute("d", /M/, { timeout: 30_000 });

  const card = page.getByRole("dialog", { name: "Export drawing" });
  const save = async (format: string, more?: () => Promise<void>) => {
    await page.getByRole("group", { name: "Drawing 1 options" }).getByRole("button", { name: "Export" }).click();
    await card.getByRole("button", { name: format, exact: true }).click();
    await more?.();
    const download = page.waitForEvent("download");
    await card.getByRole("button", { name: "Export" }).click();
    const file = await download;
    await expect(card).toHaveCount(0);
    const chunks: Buffer[] = [];
    for await (const c of (await file.createReadStream())!) chunks.push(c as Buffer);
    return { name: file.suggestedFilename(), bytes: Buffer.concat(chunks) };
  };

  // PDF: one A4 landscape page, 297 × 210 mm in points, squeezed.
  const pdf = await save("PDF");
  expect(pdf.name).toBe("Bracket rev A.pdf");
  const head = pdf.bytes.toString("latin1");
  expect(head.startsWith("%PDF-1.4")).toBe(true);
  const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(head)!;
  expect(Math.abs((Number(box[1]) / 72) * 25.4 - 297)).toBeLessThan(0.1);
  expect(Math.abs((Number(box[2]) / 72) * 25.4 - 210)).toBeLessThan(0.1);
  expect(head).toContain("/Filter /FlateDecode");
  expect(head.trimEnd().endsWith("%%EOF")).toBe(true);

  // SVG: the page in millimetres with the view's lines and the title block's text.
  const svg = (await save("SVG")).bytes.toString("utf8");
  expect(svg).toContain('width="297mm" height="210mm"');
  expect(svg).toMatch(/<path class="visible" stroke-width="0.5"[^>]* d="M[^"]{40,}"/);
  expect(svg).toMatch(/<path class="hidden" stroke-width="0.25" stroke-dasharray="2 1"/);
  expect(svg).toContain(">Bracket</text>");

  // DXF: the sheet on layers, then the front view alone at full size.
  const dxf = (await save("DXF")).bytes.toString("utf8");
  for (const layer of ["VISIBLE", "HIDDEN", "BORDER", "TITLE"]) expect(dxf).toContain(`\r\n  8\r\n${layer}\r\n`);
  const one = await save("DXF", () =>
    card
      .getByLabel("What")
      .selectOption({ label: "Front view only, at full size" })
      .then(() => {}),
  );
  expect(one.name).toBe("Bracket rev A front view.dxf");
  expect(one.bytes.toString("utf8")).not.toContain("TITLE\r\n 10");

  // PNG: A4 at 150 dpi, drawn by the browser from the same lines with the text as outlines.
  const png = await save("PNG", async () => {
    await card.getByRole("button", { name: "150 dpi" }).click();
    await expect(card.getByRole("status")).toHaveText(/1754 × 1240 pixels/);
  });
  expect(png.bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  expect([png.bytes.readUInt32BE(16), png.bytes.readUInt32BE(20)]).toEqual([1754, 1240]);
  expect(png.bytes.length).toBeGreaterThan(20_000);
});

/** Centre marks (#563): a click on a hole, or every hole in a view in one step; a mark is deleted like a view. */
test("mark the centre of a hole, delete the mark, and mark every hole in a view", { tag: "@journey" }, async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open the bracket sample" }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await newDrawing(page, "A4");
  await page.keyboard.press("b");
  const base = page.getByRole("dialog", { name: "Base view" });
  await expect(base.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await base.getByLabel("Direction").selectOption({ label: "Top" });
  await expect(base.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await base.getByRole("button", { name: "Place" }).click();
  const top = page.getByRole("button", { name: /^Top view, / });
  await expect(top.locator(".bc-view-visible")).toHaveAttribute("d", /A/, { timeout: 30_000 });

  // C arms Centre mark: the hole is offered once, and a click puts the cross on it.
  await page.keyboard.press("c");
  const card = page.getByRole("dialog", { name: "Centre mark" });
  await expect(card.getByRole("status")).toHaveText(/Click a hole or a round edge/);
  const hole = page.getByRole("button", { name: "Hole, 4.5 mm across" });
  await expect(hole).toHaveCount(1);
  await hole.click();
  const mark = page.getByRole("button", { name: "Centre mark", exact: true }).and(page.locator(".bc-mark"));
  await expect(mark).toHaveCount(1);
  await card.getByRole("button", { name: "Finish" }).click();
  await expect(card).toHaveCount(0);
  await expect(hole).toHaveCount(0);

  // Delete takes the mark away; the view stays.
  await mark.focus();
  await page.keyboard.press("Delete");
  await expect(mark).toHaveCount(0);
  await expect(top).toBeVisible();

  // The view's menu marks everything in it, and says when there is nothing left.
  await top.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add centre marks to this view" }).click();
  await expect(mark).toHaveCount(1);
  await top.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add centre marks to this view" }).click();
  await expect(page.getByText("There are no holes or round features left to mark here.")).toBeVisible();
  await expect(mark).toHaveCount(1);
});

/** Dimensions (#564): pick, the size follows the pointer, a click places it; then it is dragged and deleted. */
test("dimension an edge and a hole, drag a size by its text and delete it", { tag: "@journey" }, async ({ page }) => {
  await topViewOnA3(page);
  const top = page.getByRole("button", { name: /^Top view, / });

  // D arms Dimension. An edge gives its length, which follows the pointer until a click puts it down.
  await page.keyboard.press("d");
  const card = page.getByRole("dialog", { name: "Dimension" });
  await expect(card.getByRole("status")).toHaveText(/^Click an edge for its length/);
  const box = (await top.locator(".bc-view-hit").boundingBox())!;
  const cx = box.x + box.width / 2;
  await page.getByRole("button", { name: "Edge, 36 mm long" }).last().click();
  await expect(card.getByRole("status")).toHaveText(/^Click the sheet to place the size/);
  await page.mouse.move(cx, box.y + box.height + 30);
  await expect(page.locator(".bc-size-ghost text")).toHaveText("36");
  await page.mouse.click(cx, box.y + box.height + 30);
  const length = page.getByRole("button", { name: "Dimension, 36 mm" });
  await expect(length).toBeVisible();

  // A hole gives its diameter on a leader, wherever the text is put.
  await page.getByRole("button", { name: "Hole, 4.5 mm across", exact: true }).click({ position: { x: 1, y: 5 } });
  await page.mouse.click(cx - 30, box.y - 25);
  await expect(page.getByRole("button", { name: "Dimension, Ø4.5 mm" })).toBeVisible();
  await card.getByRole("button", { name: "Finish" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edge, 36 mm long" })).toHaveCount(0);

  // Dragging the text moves the size; the view stays where it was.
  const text = length.locator("text");
  const before = (await text.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2 + 12, { steps: 3 });
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2 + 24, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => (await text.boundingBox())!.y - before.y).toBeGreaterThan(20);
  expect((await top.locator(".bc-view-hit").boundingBox())!.y).toBeCloseTo(box.y, 0);

  // Delete takes a size away.
  await length.focus();
  await page.keyboard.press("Delete");
  await expect(length).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dimension, Ø4.5 mm" })).toBeVisible();
});

/** Stacking (#565): Arrange dimensions sorts a view's sizes into rows, the shortest nearest the part. */
test("arrange a view's dimensions into rows @journey @visual", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await topViewOnA3(page);
  const top = page.getByRole("button", { name: /^Top view, / });
  await page.keyboard.press("d");
  const card = page.getByRole("dialog", { name: "Dimension" });
  const box = (await top.locator(".bc-view-hit").boundingBox())!;
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  // Sizes put down anywhere: the overall length nearest the part, the short ones further out.
  await page.getByRole("button", { name: "Point at -20, -15 mm" }).click();
  await page.getByRole("button", { name: "Point at 20, -15 mm" }).click();
  await page.mouse.click(cx + 10, box.y + box.height + 12);
  await page.getByRole("button", { name: "Edge, 36 mm long" }).first().click();
  await page.mouse.click(cx - 20, box.y + box.height + 50);
  await page.getByRole("button", { name: "Edge, 4 mm long" }).first().click();
  await page.mouse.click(box.x - 20, box.y + box.height + 70);
  await page.getByRole("button", { name: "Edge, 30 mm long" }).first().click();
  await page.mouse.click(box.x - 60, cy + 20);
  await page.getByRole("button", { name: "Hole, 4.5 mm across", exact: true }).click({ position: { x: 1, y: 5 } });
  await page.mouse.click(cx - 30, cy + 20);
  await card.getByRole("button", { name: "Finish" }).click();
  await expect(page.locator(".bc-size")).toHaveCount(5);

  await top.locator(".bc-view-hit").click({ button: "right", position: { x: box.width / 2 + 40, y: 20 } });
  await page.getByRole("menuitem", { name: "Arrange dimensions" }).click();
  const y = async (name: string) => {
    const b = (await page.getByRole("button", { name }).locator("text").boundingBox())!;
    return b.y + b.height / 2;
  };
  // The two that meet end to end share the first row; the overall length is outside them.
  await expect.poll(async () => Math.abs((await y("Dimension, 36 mm")) - (await y("Dimension, 4 mm")))).toBeLessThan(1);
  expect((await y("Dimension, 40 mm")) - (await y("Dimension, 36 mm"))).toBeGreaterThan(10);
  expect(await y("Dimension, 36 mm")).toBeGreaterThan(box.y + box.height);
  // The hole's size is on a leader outside the view.
  const leader = (await page.getByRole("button", { name: "Dimension, Ø4.5 mm" }).locator("text").boundingBox())!;
  expect(leader.x > box.x + box.width || leader.y + leader.height < box.y).toBe(true);

  await page.locator(".bc-sheet-paper").click({ position: { x: 5, y: 5 } });
  await steady(page);
  await expect.poll(() => sheetBoxes(page), { timeout: 15_000 }).toHaveLength(1);
  await expect(page.locator(".bc-sheet-paper")).toHaveScreenshot("sheet-bracket-top-stacked.png", {
    maxDiffPixelRatio: 0.01,
    mask: [page.getByRole("button", { name: /^Date of issue/ })],
    timeout: 30_000,
  });
});

test("a sheet with a front view of the bracket @visual", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open the bracket sample" }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await newDrawing(page, "A4");
  await page.keyboard.press("b");
  const card = page.getByRole("dialog", { name: "Base view" });
  await expect(card.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await card.getByRole("button", { name: "Place" }).click();
  await expect(page.getByRole("button", { name: /^Front view, / }).locator(".bc-view-hidden")).toHaveAttribute("d", /M/, { timeout: 30_000 });
  // Nothing selected, so the picture is the sheet as it prints.
  await page.locator(".bc-sheet-paper").click({ position: { x: 5, y: 5 } });
  await steady(page);
  await expect.poll(() => sheetBoxes(page), { timeout: 15_000 }).toHaveLength(1);
  // Just the page, which the cards keep clear of at this size, with the date (today's) covered.
  await expect(page.locator(".bc-sheet-paper")).toHaveScreenshot("sheet-bracket-front.png", {
    maxDiffPixelRatio: 0.01,
    mask: [page.getByRole("button", { name: /^Date of issue/ })],
    // A first picture is taken twice to see that it holds still, which is slow on a runner with no graphics card.
    timeout: 30_000,
  });
});

test("a top view of the bracket with its hole marked @visual", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open the bracket sample" }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await newDrawing(page, "A4");
  await page.keyboard.press("b");
  const card = page.getByRole("dialog", { name: "Base view" });
  await expect(card.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await card.getByLabel("Direction").selectOption({ label: "Top" });
  await expect(card.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await card.getByRole("button", { name: "Place" }).click();
  const top = page.getByRole("button", { name: /^Top view, / });
  await expect(top.locator(".bc-view-visible")).toHaveAttribute("d", /A/, { timeout: 30_000 });
  await top.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add centre marks to this view" }).click();
  // The hole seen end on gets a centre mark, and the one through the upright, seen from the side, its centre line.
  await expect(page.locator(".bc-mark")).toHaveCount(2);
  await page.locator(".bc-sheet-paper").click({ position: { x: 5, y: 5 } });
  await steady(page);
  await expect.poll(() => sheetBoxes(page), { timeout: 15_000 }).toHaveLength(1);
  await expect(page.locator(".bc-sheet-paper")).toHaveScreenshot("sheet-bracket-top-marked.png", {
    maxDiffPixelRatio: 0.01,
    mask: [page.getByRole("button", { name: /^Date of issue/ })],
    // A first picture is taken twice to see that it holds still, which is slow on a runner with no graphics card.
    timeout: 30_000,
  });
});

test("a top view of the bracket with its sizes @visual", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await topViewOnA3(page);
  const top = page.getByRole("button", { name: /^Top view, / });
  await page.keyboard.press("d");
  const card = page.getByRole("dialog", { name: "Dimension" });
  const box = (await top.locator(".bc-view-hit").boundingBox())!;
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.getByRole("button", { name: "Edge, 36 mm long" }).last().click();
  await page.mouse.click(cx, box.y + box.height + 30);
  await page.getByRole("button", { name: "Edge, 30 mm long" }).first().click();
  await page.mouse.click(box.x - 30, cy);
  await page.getByRole("button", { name: "Hole, 4.5 mm across", exact: true }).click({ position: { x: 1, y: 5 } });
  await page.mouse.click(cx - 30, box.y - 25);
  await card.getByRole("button", { name: "Finish" }).click();
  await expect(page.locator(".bc-size")).toHaveCount(3);
  await page.locator(".bc-sheet-paper").click({ position: { x: 5, y: 5 } });
  await steady(page);
  await expect.poll(() => sheetBoxes(page), { timeout: 15_000 }).toHaveLength(1);
  await expect(page.locator(".bc-sheet-paper")).toHaveScreenshot("sheet-bracket-top-sizes.png", {
    maxDiffPixelRatio: 0.01,
    mask: [page.getByRole("button", { name: /^Date of issue/ })],
    timeout: 30_000,
  });
});

test("a drawing opens by touch, and a pinch zooms the sheet", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 820, height: 1180 }, storageState: test.info().project.use.storageState });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Pick: Bodies" }).waitFor();
  await page.getByRole("button", { name: "Shaded" }).tap();
  await page.getByRole("menuitem", { name: "New drawing" }).tap();
  await page.getByRole("dialog", { name: "New drawing" }).getByRole("button", { name: "Create" }).tap();
  const paper = page.locator(".bc-sheet-paper");
  await expect(paper).toBeVisible();
  const before = (await paper.boundingBox())!;
  // Two fingers moving apart about the middle of the sheet.
  const cx = before.x + before.width / 2;
  const cy = before.y + before.height / 2;
  await page.evaluate(
    ([x, y]) => {
      const el = document.querySelector(".bc-drawing")!;
      const fire = (type: string, id: number, px: number) =>
        el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", clientX: px, clientY: y, bubbles: true, isPrimary: id === 1 }));
      fire("pointerdown", 1, x! - 20);
      fire("pointerdown", 2, x! + 20);
      for (let i = 1; i <= 8; i++) {
        fire("pointermove", 1, x! - 20 - i * 5);
        fire("pointermove", 2, x! + 20 + i * 5);
      }
      fire("pointerup", 1, x! - 60);
      fire("pointerup", 2, x! + 60);
    },
    [cx, cy],
  );
  await expect.poll(async () => (await paper.boundingBox())!.width).toBeGreaterThan(before.width * 2);
  await page.getByRole("button", { name: "Finish drawing" }).tap();
  await expect(paper).toHaveCount(0);
  await context.close();
});

for (const theme of ["light", "dark", "holoroom"] as const) {
  test(`a drawing's sheet and its settings have no axe violations in ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("bettercad.theme", t), theme);
    await page.goto("/");
    await page.getByRole("button", { name: "Pick: Bodies" }).waitFor();
    await newDrawing(page, "letter");
    const check = async () => {
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    };
    await check();
    await page.getByRole("button", { name: "Sheet settings" }).click();
    await expect(page.getByRole("dialog", { name: "Sheet settings" })).toBeVisible();
    await check();
  });
}

test("auto dimension a view, turn the slider up and keep the sizes @journey @visual", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await topViewOnA3(page);
  const top = page.getByRole("button", { name: /^Top view, / });
  await page
    .getByRole("button", { name: /^Auto dimension/ })
    .first()
    .click();
  const card = page.getByRole("dialog", { name: "Auto dimension" });
  const status = card.getByRole("status");
  await expect(status).toHaveText(/^\d+ of \d+ dimensions$/);
  const total = Number((await status.textContent())!.split(" ")[2]);
  // The sheet shows the sizes as you choose. All the way down leaves the two overall sizes.
  const slider = card.getByRole("slider", { name: "How many sizes" });
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(status).toHaveText(`2 of ${total} dimensions`);
  await expect(page.locator(".bc-size")).toHaveCount(2);
  await page.keyboard.press("End");
  await expect(status).toHaveText(`${total} of ${total} dimensions`);
  await expect(page.locator(".bc-size")).toHaveCount(total);
  // Chain with centre marks measures one after another and marks the holes.
  await card.getByRole("radio", { name: /^Chain with centre marks/ }).check();
  await expect(page.locator(".bc-mark")).not.toHaveCount(0);
  await card.getByRole("radio", { name: /^Baseline with centre marks/ }).check();
  await expect(status).toHaveText(`${total} of ${total} dimensions`);
  await card.getByRole("button", { name: "OK" }).click();
  await expect(card).toBeHidden();
  await expect(page.locator(".bc-size")).toHaveCount(total);
  // The overall length is under the view, outside the shorter sizes.
  const box = (await top.locator(".bc-view-hit").boundingBox())!;
  const length = (await page.getByRole("button", { name: "Dimension, 40 mm" }).locator("text").boundingBox())!;
  const short = (await page.getByRole("button", { name: "Dimension, 4 mm" }).locator("text").boundingBox())!;
  expect(short.y).toBeGreaterThan(box.y + box.height);
  expect(length.y).toBeGreaterThan(short.y + 10);

  // Undo takes them all off in one go.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".bc-size")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator(".bc-size")).toHaveCount(total);

  await page.locator(".bc-sheet-paper").click({ position: { x: 5, y: 5 } });
  await steady(page);
  await expect.poll(() => sheetBoxes(page), { timeout: 15_000 }).toHaveLength(1);
  await expect(page.locator(".bc-sheet-paper")).toHaveScreenshot("sheet-bracket-top-auto.png", {
    maxDiffPixelRatio: 0.01,
    mask: [page.getByRole("button", { name: /^Date of issue/ })],
    timeout: 30_000,
  });
});

test("change the model and the drawing's sizes follow it @journey", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await topViewOnA3(page);
  await page
    .getByRole("button", { name: /^Auto dimension/ })
    .first()
    .click();
  const card = page.getByRole("dialog", { name: "Auto dimension" });
  await card.getByRole("slider", { name: "How many sizes" }).focus();
  await page.keyboard.press("End");
  await card.getByRole("button", { name: "OK" }).click();
  await expect(page.getByRole("button", { name: "Dimension, 40 mm" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dimension, Ø4.5 mm" })).toBeVisible();
  const count = await page.locator(".bc-size").count();
  const top = page.getByRole("button", { name: /^Top view, / });
  const under = async (name: string) => {
    const view = (await top.locator(".bc-view-visible").boundingBox())!;
    const text = (await page.getByRole("button", { name }).locator("text").boundingBox())!;
    return text.y - (view.y + view.height);
  };
  const gap = await under("Dimension, 40 mm");
  expect(gap).toBeGreaterThan(0);

  // A longer leg and a bigger hole, from Parameters.
  await page.getByRole("banner").getByRole("button", { name: "Parameters", exact: true }).click();
  const leg = page.getByRole("textbox", { name: "Expression for leg" });
  await leg.fill("60");
  await page.keyboard.press("Enter");
  const hole = page.getByRole("textbox", { name: "Expression for hole" });
  await hole.fill("6");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Value of hole")).toHaveText("6 mm");

  // The same sizes read the new model, nothing is lost, and the length is still its row's distance under the view.
  await expect(page.getByRole("button", { name: "Dimension, 60 mm" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Dimension, Ø6 mm" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dimension, 40 mm" })).toHaveCount(0);
  await expect(page.locator(".bc-size")).toHaveCount(count);
  await expect(page.locator(".bc-lost")).toHaveCount(0);
  await expect.poll(async () => Math.abs((await under("Dimension, 60 mm")) - gap)).toBeLessThan(2);
});

test("an ASME sheet of the phone stand, dimensioned for you @visual", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open the phone stand sample" }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  // A US page size starts the sheet to ASME: third angle, and sizes that read level.
  await newDrawing(page, "tabloid");
  await page.keyboard.press("b");
  const base = page.getByRole("dialog", { name: "Base view" });
  await expect(base.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await base.getByRole("button", { name: "Place" }).click();
  const front = page.getByRole("button", { name: /^Front view, / });
  await expect(front.locator(".bc-view-visible")).toHaveAttribute("d", /L/, { timeout: 30_000 });
  await page
    .getByRole("button", { name: /^Auto dimension/ })
    .first()
    .click();
  const card = page.getByRole("dialog", { name: "Auto dimension" });
  await card.getByRole("slider", { name: "How many sizes" }).focus();
  await page.keyboard.press("End");
  await card.getByRole("radio", { name: /^Chain\s*\d/ }).check();
  await card.getByRole("button", { name: "OK" }).click();
  await expect(page.getByRole("button", { name: "Dimension, 45°" })).toBeVisible();
  await expect(page.locator(".bc-lost")).toHaveCount(0);

  await page.locator(".bc-sheet-paper").click({ position: { x: 5, y: 5 } });
  await steady(page);
  await expect.poll(() => sheetBoxes(page), { timeout: 15_000 }).toHaveLength(1);
  await expect(page.locator(".bc-sheet-paper")).toHaveScreenshot("sheet-phone-stand-asme.png", {
    maxDiffPixelRatio: 0.01,
    mask: [page.getByRole("button", { name: /^Date: / })],
    timeout: 30_000,
  });
});
