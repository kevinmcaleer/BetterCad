# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: web/e2e/drawing.spec.ts >> project top and side views from a front view; they stay lined up and follow the standard
- Location: web/e2e/drawing.spec.ts:139:1

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/", waiting until "load"

```

# Test source

```ts
  40  |   await page.keyboard.press("Enter");
  41  |   await expect(block.getByRole("button", { name: "Drawing number: BC-001" })).toBeVisible();
  42  |   await block.getByRole("button", { name: "Title: Untitled model" }).focus();
  43  |   await page.keyboard.press("Enter");
  44  |   await page.getByRole("textbox", { name: "Title" }).fill("Bracket");
  45  |   await page.keyboard.press("Enter");
  46  |   await expect(block.getByRole("button", { name: "Title: Bracket" })).toBeVisible();
  47  | 
  48  |   // The wheel zooms and F fits the sheet again.
  49  |   await page.mouse.move(paper.x + 100, paper.y + 100);
  50  |   await page.mouse.wheel(0, -400);
  51  |   await expect.poll(async () => (await sheet.locator(".bc-sheet-paper").boundingBox())!.width).toBeGreaterThan(paper.width * 1.2);
  52  |   await page.keyboard.press("f");
  53  |   await expect.poll(async () => Math.round((await sheet.locator(".bc-sheet-paper").boundingBox())!.width)).toBe(Math.round(paper.width));
  54  | 
  55  |   // Sheet settings turns the page and switches the standard.
  56  |   await page.getByRole("button", { name: "Sheet settings" }).click();
  57  |   const settings = page.getByRole("dialog", { name: "Sheet settings" });
  58  |   await expect(settings.getByRole("textbox", { name: "Drawing number" })).toHaveValue("BC-001");
  59  |   await settings.getByRole("button", { name: "Portrait" }).click();
  60  |   await settings.getByLabel("Standard").selectOption("asme");
  61  |   await settings.getByRole("button", { name: "Done" }).click();
  62  |   await expect(page.getByRole("group", { name: "Sheet 1: A3, portrait" })).toBeVisible();
  63  |   await expect(block.getByRole("img", { name: "Projection: third angle" })).toBeVisible();
  64  | 
  65  |   // Esc goes back to the model; the drawing is in the browser, and a double-click opens it as it was left.
  66  |   await page.keyboard.press("Escape");
  67  |   await expect(page.getByRole("region", { name: "Drawing: Drawing 1" })).toHaveCount(0);
  68  |   await expect(page.getByRole("button", { name: "Pick: Bodies" })).toBeVisible();
  69  |   await page.getByRole("treeitem", { name: /^Drawing 1/ }).dblclick();
  70  |   await expect(page.getByRole("group", { name: "Sheet 1: A3, portrait" })).toBeVisible();
  71  |   await expect(block.getByRole("button", { name: "Title: Bracket" })).toBeVisible();
  72  |   await page.getByRole("button", { name: "Finish drawing" }).click();
  73  |   await expect(page.getByRole("region", { name: "Drawing: Drawing 1" })).toHaveCount(0);
  74  | 
  75  |   // Undo steps back through the drawing's changes like any others, down to there being no drawing.
  76  |   for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Undo" }).click();
  77  |   await expect(page.getByRole("treeitem", { name: /^Drawing 1/ })).toHaveCount(0);
  78  | });
  79  | 
  80  | /** Base view (#561): the model's lines on the sheet, from the real kernel. */
  81  | test("place a base view of the bracket, move it, change it and delete it", { tag: "@journey" }, async ({ page }) => {
  82  |   await page.goto("/");
  83  |   await page.getByRole("button", { name: "Open the bracket sample" }).click();
  84  |   await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  85  |   await newDrawing(page, "A3");
  86  |   const paper = (await page.locator(".bc-sheet-paper").boundingBox())!;
  87  | 
  88  |   // B arms Base view: its card opens, and the view follows the pointer until a click puts it down.
  89  |   await page.keyboard.press("b");
  90  |   const card = page.getByRole("dialog", { name: "Base view" });
  91  |   await expect(card.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  92  |   await expect(card.getByLabel("Scale")).toContainText("Fit, 2:1");
  93  |   await page.mouse.move(paper.x + paper.width * 0.3, paper.y + paper.height * 0.4);
  94  |   await expect(page.locator(".bc-view-ghost path")).toHaveAttribute("d", /M/);
  95  |   await page.mouse.click(paper.x + paper.width * 0.3, paper.y + paper.height * 0.4);
  96  |   await expect(card).toHaveCount(0);
  97  |   const front = page.getByRole("button", { name: "Front view, 2:1" });
  98  |   await expect(front).toBeVisible({ timeout: 30_000 });
  99  |   // The bracket from the front is an L with its two holes behind, dashed; the title block takes the view's scale.
  100 |   await expect(front.locator(".bc-view-visible")).toHaveAttribute("d", /^(M[^M]+){6,}$/);
  101 |   await expect(front.locator(".bc-view-hidden")).toHaveAttribute("d", /M/);
  102 |   await expect(page.getByRole("img", { name: "Scale: 2:1" })).toBeVisible();
  103 |   const box = (await front.boundingBox())!;
  104 |   expect(Math.abs(box.x + box.width / 2 - (paper.x + paper.width * 0.3))).toBeLessThan(3);
  105 | 
  106 |   // Drag it across the sheet.
  107 |   await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  108 |   await page.mouse.down();
  109 |   await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, { steps: 5 });
  110 |   await page.mouse.up();
  111 |   await expect.poll(async () => Math.round((await front.boundingBox())!.x - box.x)).toBe(120);
  112 | 
  113 |   // A second view by keyboard: an isometric, placed in the middle of the clear space with Enter.
  114 |   await page.keyboard.press("b");
  115 |   await card.getByLabel("Direction").selectOption({ label: "Isometric, front right" });
  116 |   await expect(card.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  117 |   await card.getByLabel("Direction").press("Enter");
  118 |   const iso = page.getByRole("button", { name: /^Isometric view, / });
  119 |   await expect(iso).toBeVisible({ timeout: 30_000 });
  120 |   await expect(iso.locator(".bc-view-visible")).toHaveAttribute("d", /A/, { timeout: 30_000 });
  121 | 
  122 |   // Double-click changes a view; Delete takes it away; the drawing keeps its views when you leave and come back.
  123 |   await iso.dblclick();
  124 |   await card.getByLabel("Direction").selectOption({ label: "Top" });
  125 |   await card.getByRole("button", { name: "Done" }).click();
  126 |   const top = page.getByRole("button", { name: /^Top view, / });
  127 |   await expect(top).toBeVisible({ timeout: 30_000 });
  128 |   await page.keyboard.press("Escape");
  129 |   await expect(page.getByRole("region", { name: "Drawing: Drawing 1" })).toHaveCount(0);
  130 |   await page.getByRole("treeitem", { name: /^Drawing 1/ }).dblclick();
  131 |   await expect(top).toBeVisible({ timeout: 30_000 });
  132 |   await expect(front).toBeVisible();
  133 |   await top.focus();
  134 |   await page.keyboard.press("Delete");
  135 |   await expect(top).toHaveCount(0);
  136 |   await expect(front).toBeVisible();
  137 | });
  138 | 
  139 | test("project top and side views from a front view; they stay lined up and follow the standard", { tag: "@journey" }, async ({ page }) => {
> 140 |   await page.goto("/");
      |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  141 |   await page.getByRole("button", { name: "Open the bracket sample" }).click();
  142 |   await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  143 |   await newDrawing(page, "A3");
  144 |   await page.keyboard.press("b");
  145 |   const base = page.getByRole("dialog", { name: "Base view" });
  146 |   await expect(base.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  147 |   await base.getByLabel("Scale").selectOption({ label: "1:1" });
  148 |   await base.getByRole("button", { name: "Place" }).click();
  149 |   const front = page.getByRole("button", { name: "Front view, 1:1" });
  150 |   await expect(front.locator(".bc-view-visible")).toHaveAttribute("d", /M/, { timeout: 30_000 });
  151 |   const mid = async (l: typeof front) => {
  152 |     const b = (await l.boundingBox())!;
  153 |     return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  154 |   };
  155 |   const f = await mid(front);
  156 | 
  157 |   // P arms Projected view from the view that is selected. A3 is first angle: below is the top view, left the right.
  158 |   await page.keyboard.press("p");
  159 |   const card = page.getByRole("dialog", { name: "Projected view" });
  160 |   await expect(card.getByLabel("From")).toHaveValue(/.+/);
  161 |   await page.mouse.move(f.x + 6, f.y + 150);
  162 |   await expect(card.getByLabel("Side")).toHaveValue("below");
  163 |   await expect(card.getByRole("status")).toHaveText(/Move the pointer away/, { timeout: 30_000 });
  164 |   await expect(page.locator(".bc-view-ghost path")).toHaveAttribute("d", /M/);
  165 |   await page.mouse.click(f.x + 6, f.y + 150);
  166 |   const top = page.getByRole("button", { name: "Top view, 1:1" });
  167 |   await expect(top.locator(".bc-view-visible")).toHaveAttribute("d", /A/, { timeout: 30_000 });
  168 |   await page.mouse.move(f.x - 180, f.y - 8);
  169 |   await expect(card.getByLabel("Side")).toHaveValue("left");
  170 |   await expect(card.getByRole("status")).toHaveText(/Move the pointer away/, { timeout: 30_000 });
  171 |   await page.mouse.click(f.x - 180, f.y - 8);
  172 |   const right = page.getByRole("button", { name: "Right view, 1:1" });
  173 |   await expect(right.locator(".bc-view-visible")).toHaveAttribute("d", /M/, { timeout: 30_000 });
  174 |   await page.keyboard.press("Enter");
  175 |   await expect(card).toHaveCount(0);
  176 |   // In line with the front view, whatever the pointer was off by.
  177 |   expect(Math.abs((await mid(top)).x - f.x)).toBeLessThan(1.5);
  178 |   expect((await mid(top)).y).toBeGreaterThan(f.y + 100);
  179 |   expect(Math.abs((await mid(right)).y - f.y)).toBeLessThan(1.5);
  180 |   expect((await mid(right)).x).toBeLessThan(f.x - 100);
  181 | 
  182 |   // The top view slides along its line only, and dragging the front view carries both.
  183 |   const t = await mid(top);
  184 |   await page.mouse.move(t.x, t.y);
  185 |   await page.mouse.down();
  186 |   await page.mouse.move(t.x + 60, t.y + 20, { steps: 4 });
  187 |   await page.mouse.up();
  188 |   await expect.poll(async () => Math.round((await mid(top)).y - t.y)).toBe(20);
  189 |   expect(Math.abs((await mid(top)).x - f.x)).toBeLessThan(1.5);
  190 |   await page.mouse.move(f.x, f.y);
  191 |   await page.mouse.down();
  192 |   await page.mouse.move(f.x + 40, f.y - 30, { steps: 4 });
  193 |   await page.mouse.up();
  194 |   await expect.poll(async () => Math.round((await mid(front)).x - f.x)).toBe(40);
  195 |   expect(Math.abs((await mid(top)).x - (f.x + 40))).toBeLessThan(1.5);
  196 |   expect(Math.abs((await mid(right)).y - (f.y - 30))).toBeLessThan(1.5);
  197 | 
  198 |   // Third angle swaps them over: the top view goes above the front, the right view to its right.
  199 |   await page.getByRole("button", { name: "Sheet settings" }).first().click();
  200 |   const settings = page.getByRole("dialog", { name: "Sheet settings" });
  201 |   await settings.getByLabel("Standard").selectOption("asme");
  202 |   await settings.getByRole("button", { name: "Done" }).click();
  203 |   await expect.poll(async () => (await mid(top)).y < (await mid(front)).y).toBe(true);
  204 |   expect((await mid(right)).x).toBeGreaterThan((await mid(front)).x);
  205 | 
  206 |   // Deleting the front view asks first, and keeps the others.
  207 |   await front.focus();
  208 |   await page.keyboard.press("Delete");
  209 |   await page.getByRole("dialog", { name: "Delete this view?" }).getByRole("button", { name: "Delete" }).click();
  210 |   await expect(front).toHaveCount(0);
  211 |   await expect(top).toBeVisible();
  212 |   await expect(right).toBeVisible();
  213 | });
  214 | 
  215 | test("a sheet with a front view of the bracket @visual", async ({ page }) => {
  216 |   await page.setViewportSize({ width: 1280, height: 800 });
  217 |   await page.goto("/");
  218 |   await page.getByRole("button", { name: "Open the bracket sample" }).click();
  219 |   await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  220 |   await newDrawing(page, "A4");
  221 |   await page.keyboard.press("b");
  222 |   const card = page.getByRole("dialog", { name: "Base view" });
  223 |   await expect(card.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  224 |   await card.getByRole("button", { name: "Place" }).click();
  225 |   await expect(page.getByRole("button", { name: /^Front view, / }).locator(".bc-view-hidden")).toHaveAttribute("d", /M/, { timeout: 30_000 });
  226 |   // Nothing selected, so the picture is the sheet as it prints.
  227 |   await page.locator(".bc-sheet-paper").click({ position: { x: 5, y: 5 } });
  228 |   // Just the page, which the cards keep clear of at this size, with the date (today's) covered.
  229 |   await expect(page.locator(".bc-sheet-paper")).toHaveScreenshot("sheet-bracket-front.png", {
  230 |     maxDiffPixelRatio: 0.01,
  231 |     mask: [page.getByRole("button", { name: /^Date of issue/ })],
  232 |   });
  233 | });
  234 | 
  235 | test("a drawing opens by touch, and a pinch zooms the sheet", async ({ browser }) => {
  236 |   const context = await browser.newContext({ hasTouch: true, viewport: { width: 820, height: 1180 }, storageState: test.info().project.use.storageState });
  237 |   const page = await context.newPage();
  238 |   await page.goto("/");
  239 |   await page.getByRole("button", { name: "Pick: Bodies" }).waitFor();
  240 |   await page.getByRole("button", { name: "Shaded" }).tap();
```