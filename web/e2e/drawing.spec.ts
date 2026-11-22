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
