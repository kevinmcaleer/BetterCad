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
  // Just the page, which the cards keep clear of at this size, with the date (today's) covered.
  await expect(page.locator(".bc-sheet-paper")).toHaveScreenshot("sheet-bracket-front.png", {
    maxDiffPixelRatio: 0.01,
    mask: [page.getByRole("button", { name: /^Date of issue/ })],
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
