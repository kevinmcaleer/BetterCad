# Drawings

A drawing is a sheet of flat views of your model, with centre marks, dimensions and a title block, ready to print or
send to a workshop. It lives inside the model file, so it travels with the `.bcad` and follows the model when that
changes. The code is in `web/src/drawing/`, a chunk that loads the first time a drawing opens; the kernel's side is
`packages/kernel/src/drawing.ts` (the data) and `packages/kernel/src/occt/project.ts` (the views).

## Making one

Open the view style menu (Shaded) and choose **New drawing**. Pick a page size and the sheet opens in place of the 3D
view. Drawings are listed under **Drawings** in the browser; double-click one to open it, and **Finish drawing** goes
back to the model.

| Key | Tool | What it does |
| --- | --- | --- |
| B | Base view | The first view of a part: choose what it shows, the direction and the scale, then click the sheet. |
| P | Projected view | Views lined up with a base view. Move the pointer to a side of it and click. |
| C | Centre mark | A cross on a hole or arc. Centre mark pattern, Centre line and Edge extension are beside it. |
| D | Dimension | Click an edge, a circle, or two things to measure between, then click where the size goes. |
| | Auto dimension | Dimensions the sheet for you. |
| | Arrange dimensions | Sorts a view's sizes into rows. |
| F | Fit sheet | Fits the whole page in the window. |

Every tool is also on the Drawing tab of the ribbon and under Ctrl+K (⌘K).

## Page sizes and standards

A series pages (A4 to A0) start a sheet to ISO: first angle projection, sizes written along their lines, 8 mm between
rows of dimensions. US pages (Letter to ANSI E) start it to ASME: third angle, sizes written level, 6 mm between rows.
**Sheet settings** switches either, and sets the scale, the border and the row spacing. The title block is at the
bottom right; double-click a field to type in it.

## Dimensions

A dimension is fixed to the edges and faces it measures by their names (`docs/topological-naming.md`), not to where
they were. It always reads the model: you cannot type a different number over it. Right-click one for its decimal
places or to delete it; drag its text to move it, and it drops into a row when you let go near one.

**Arrange dimensions** (right-click a view) stacks a view's sizes in rows: the shortest nearest the part, each longer
one outside it, the overall size outermost. Sizes that don't overlap share a row. Hole sizes go on leaders outside the
view. If the rows run into a neighbouring view, you're asked whether to move that view out of the way.

## Auto dimension

Auto dimension works out every size the sheet's views could show and ranks them, best first:

1. overall sizes
2. hole positions
3. hole sizes (one per size of hole, counted: "4× Ø5")
4. steps
5. small steps (under 15% of the overall size)
6. radii and angles

A size is shown once: a later view leaves out any length an earlier view has. Pictorial views are left alone.

| Choice | What it does |
| --- | --- |
| Baseline | Every position is measured from one corner. |
| Chain | Each position is measured from the one before. |
| With centre marks | The same, and every hole is marked first. |
| Measure from | The corner (or the centre) positions start from. |
| How many sizes | From the overall sizes alone up to everything on the list. |

The sheet shows the result as you choose. **OK** keeps it as one undo step. Running it again replaces the sizes it
added and keeps the ones you placed or moved by hand; **Run Auto dimension again** on a view's menu does that with the
last settings. The ranking is `candidates` in `web/src/drawing/auto.ts`.

## When the model changes

Views are drawn again from the model whenever it changes; only the views whose bodies changed are rebuilt.

- Sizes read their new values. Where that changes a view's size or the order of its rows, the rows are stacked again.
  Sizes you placed outside the rows keep their distance from the view's outline.
- A mark or dimension whose edge or face has gone stays where it was as a warning triangle. Right-click it for
  **Pick again** or **Delete**. The browser counts the problems on the open drawing's row.
- A view whose body was deleted or hidden is an empty frame that says **Nothing to show**.

Nothing is written to the file until your next change, which then includes the re-stacked rows, so one undo takes both
back (`web/src/drawing/follow.ts`).

## Export

**Export** writes the sheet as PDF, SVG, DXF or PNG, or prints it. Exports are black on white whatever the theme, and
text is written as outlines so it looks the same everywhere. DXF puts lines on layers: VISIBLE, HIDDEN, CENTRE,
DIMENSIONS, BORDER and TITLE. A single view can also be exported at full size as DXF or SVG for a laser cutter. Every
format is written from one picture of the sheet, `sheetScene` in `web/src/drawing/export/scene.ts`.

## Tests

- `web/src/drawing/*.test.ts(x)`: the layout, each tool, Auto dimension's lists and following the model, on made-up views.
- `fixtures/drawings/`: two real models with drawings, drawn by the real kernel (`web/src/drawing/fixtures.test.ts`).
  Each has a golden list of what Auto dimension offers, in `*.auto.txt`. After a deliberate change, run
  `UPDATE_GOLDEN=1 npm run test:golden` and read the diff. The nightly run also writes each sheet to SVG, PDF and DXF
  and checks nothing was dropped.
- `web/e2e/drawing.spec.ts`: the journeys, axe in all three themes, and pictures of an ISO and an ASME sheet.
- `budgets.json` has a line for the drawing chunk, and the kernel bench times a projected view.

## Not yet

Section, detail and break views, more than one sheet, notes and symbols, a parts list with balloons, and templates
with a logo are release 2 (#571 to #575). Ordinate dimensions and tolerances are not planned yet.
