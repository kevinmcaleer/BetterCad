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

## View styles

Select a base or projected view and its **Style** is in the properties panel on the right:

- **Line art** (the default): the edges you see, and hidden edges dashed when the view has them on.
- **Wireframe**: every edge solid, the ones behind too.
- **Shaded**: the bodies in their colours, lit as the modelling view is, under the edges you see.
- **Rendered**: path traced in each body's colour and finish, with no lines. It shows shaded while the path tracer
  works, and stays shaded if the browser takes more than 30 s.

A projected view starts with its parent's style, and follows it while it still has the parent's old one. Section and
detail views, and views with breaks, are always line art. The pictures come from `web/src/drawing/pictures.ts`, which
frames the bodies square on through an orthographic camera matching the view's box, so they lie exactly under its
lines. They are JPEGs on white, laid over the paper with multiply so the white takes the paper's colour in every theme.

## Page sizes and standards

A series pages (A4 to A0) start a sheet to ISO: first angle projection, sizes written along their lines, 8 mm between
rows of dimensions. US pages (Letter to ANSI E) start it to ASME: third angle, sizes written level, 6 mm between rows.
**Sheet settings** switches either, and sets the scale, the border and the row spacing. The title block is at the
bottom right; double-click a field to type in it.

## Your own title block and templates

**Sheet settings** adds to the title block (#575):

- **Logo**: choose a picture. It is brought down to 480 pixels on its longest side, put on white and kept in the model
  file as a JPEG, so it travels with the drawing and goes into a PDF as it is.
- **Your own fields**: up to 8, each a name and a value (Material, Finish, Project). They sit four to a row above the
  standard's rows, with the logo first, and the block grows upward to hold them. Views, the parts list and export all
  read the same layout, so nothing overlaps.

The logo and your fields belong to the drawing, so every sheet of it shows them. SVG, PDF and PNG exports carry the
logo; DXF has no pictures, so there the logo's cell is an empty box.

**Save as a template** in Sheet settings keeps the page size, which way up, the standard, the border, the title block
(all but the title and the date, which are each drawing's own), the logo, your fields, and whether a new drawing starts
with views. **New drawing** then has a **Template** list: pick one and Create. **First views** set to "Front, top,
side and isometric" lays the four out on the first sheet where the standard puts them, at the largest standard scale
that fits, as Make drawings of every part does. Tick **Start new drawings from this** and the card opens on that
template every time; untick it to go back to the page you last used. You can keep 20 templates.

Templates live in this browser (`bettercad.drawingTemplates`) and, when you are signed in, in your account
(`/api/templates`, `server/bettercad/templates.py`), the same way printer profiles do: the account's copy wins, and
ones made offline go up when you sign in. Your default is part of the template, so it follows you too.

## Sheets

A drawing can have more than one sheet. The strip under the page has a tab for each, with a small picture of it, and a
plus to add one. A new sheet takes the open sheet's page, standard, scale and title block. Arrow keys go from sheet to
sheet, F2 renames, Delete deletes (a drawing keeps at least one), Alt with an arrow moves a sheet along, and right-click
has Duplicate. Each sheet has its own page size; the title block is the drawing's, so a field typed on one sheet is on
them all, and the sheet count ("2/3") fills itself in. Right-click a view for **Move to** another sheet: its projected
views, marks and dimensions go with it. Export has **All sheets** for PDF, one page each at its own size.

## Section, detail and broken views

**Section view** cuts a view on a line and shows what is inside. Pick the view, choose a line across it or up it, and
click where the cut goes; it snaps to a hole's centre and to the middle. The section sits in line with its parent, on
the side the standard's projection puts it, and can be dragged along that line. The parent gets the cutting line, its
arrows and letters (A, B, C; never I, O or Q), and the section is captioned "A-A" (ISO) or "SECTION A-A" (ASME). Cut
faces are hatched at 45°, 2.5 mm apart on paper, each body its own way. Right-click a section for **Look from the
other side**. A cutting line is straight and level or upright: stepped and slanted cuts are not here yet.

The kernel does the cut (`projectView` with `cut`), so a section's lines are the model's own. Edges behind the cut keep
their names; each piece of the cut face's outline is named for the face the cut goes through. So a dimension or
centre mark on a section follows the model like any other, and Auto dimension sizes what the cut shows: a blind hole's
floor, a counterbore's step. Hidden edges are never dimensioned, so a section is how the inside gets its sizes.

**Detail view** draws a circle of a view larger. Click the centre, or set the radius and scale on the card. The parent
gets the circle and its letter; the detail is captioned "B (5:1)" or "DETAIL B, SCALE 5:1". A dimension on a detail
reads the whole edge, not the piece inside the circle. Auto dimension leaves details alone: their parent has the sizes.

**Break** leaves a stretch of a long part out, between two clicks, and draws what is past it closer, with two break
lines 4 mm apart. A dimension across a break still reads the true size. Right-click the view for **Remove breaks**.

A section or detail whose parent is deleted stays as it is, without its mark on the parent. All three are worked out
in `web/src/drawing/cuts.ts` from the kernel's picture, and written by every export from the same lines (DXF layer
`SECTION`).

## Notes, symbols and tolerances

The **Text** group of the Drawing tab (one **Note** button on the narrow bar, with the kind on its card) writes on the
sheet:

- **Text** is loose: type it and click the sheet. It sits where you put it, from the page's bottom left corner.
- **Leader** points your words at an edge or hole.
- **Hole note** reads the hole you click. A hole made by a Hole step says what the step says: how many, its
  diameter, its depth or "through", a tapped hole's thread ("M3 × 0.5") and its counterbore or countersink. Any other
  hole gives its diameter and how many like it the view shows. The note is worked out each time it is drawn, so it
  follows the model.
- **Surface finish**, **Datum** and **Feature control frame** draw the symbol on a leader: a tick with its roughness,
  a boxed letter with a filled triangle (letters go A, B, C; never I, O or Q), and a frame with its characteristic,
  tolerance and datums.

Every note is a button named for what it says. Drag it by its text, nudge it with the arrow keys, press Enter or
double-click to change its words, Delete to remove it. A note pointing into a view moves with the view, goes with it
to another sheet, and is deleted with it. One whose edge has gone from the model shows as a lost note, with Pick
again, like a lost dimension.

Right-click a dimension for **Tolerance…**: plus and minus ("40 ±0.1", or "40 +0.2/-0.05"), limits
("40.2 / 39.9"), or one of the printer's fits, written with the gap from the model's print settings
("10 sliding fit, 0.25 gap"). The tolerance only changes what the size says; the model is not changed.

Notes are worked out in `web/src/drawing/notes.ts` as lines and text, and every export writes the same ones (DXF
layer `DIMENSIONS`).

## Parts list and balloons

**Parts list** puts a table above the title block: item number, part, quantity and material. It is worked out from
the model each time it is drawn (`web/src/drawing/parts.ts`), so it never goes stale:

- a row for each top-level component (with everything inside it) and each body outside one, in build order;
- two inserts of the same model are one row with a count of 2, and so is a body with its patterned copies. A mirrored
  copy is a part of its own;
- printed parts take the model's print material; catalogue parts and reference bodies say "Bought";
- holes and hidden bodies are left out, as they are from views.

Click the button again, press Delete on the table or right-click it to take it off the sheet.

A **Balloon** is a part's item number in a circle with an arrow to the part. The Balloon tool (in the Note card's
Kind list, or the Tables group of the Drawing tab) numbers the part whose edge you click. **Add balloons** on a
view's menu gives every part the view shows a balloon, set out round the view on the side its part is on, and skips
parts that have one. A balloon reads its number from the list each time, so the two always agree. It is a note, so
it drags, deletes, exports and follows its view like one.

**Make drawings of every part** (the view style menu, the Drawings menu in the browser, or Ctrl+K) makes a drawing
for each row of the parts list, named for its part, on the page you last set up: a front view, the views above or
below and beside it where the standard puts them, and an isometric, at the largest standard scale that fits
(`firstViews.ts`, `everyPart.ts`). A part that already has a drawing of its name is skipped, so running it again
only adds what is new. It is one step in Undo.

Exploded views wait for the model to be able to save one. The fuller parts list for printing and buying (weights,
print times, a CSV) is #494; it can start from `partsRows`.

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
format is written from one picture of the sheet, `sheetScene` in `web/src/drawing/export/scene.ts`. Shaded and
rendered views go into PDF, SVG and PNG as their pictures (about 200 and 125 dpi); DXF has no pictures, so it gets
their lines as line art.

## Tests

- `web/src/drawing/*.test.ts(x)`: the layout, each tool, Auto dimension's lists and following the model, on made-up views.
- `fixtures/drawings/`: two real models with drawings, drawn by the real kernel (`web/src/drawing/fixtures.test.ts`).
  Each has a golden list of what Auto dimension offers, in `*.auto.txt`. After a deliberate change, run
  `UPDATE_GOLDEN=1 npm run test:golden` and read the diff. The nightly run also writes each sheet to SVG, PDF and DXF
  and checks nothing was dropped.
- `server/tests/test_templates.py`: the account's templates.
- `web/e2e/drawing.spec.ts`: the journeys, axe in all three themes, and pictures of an ISO and an ASME sheet.
- `budgets.json` has a line for the drawing chunk, and the kernel bench times a projected view.

## Not yet

Exploded views wait for the model to save one. Stepped, slanted and half
sections are not planned yet. Ordinate dimensions are not planned yet. Weld symbols and a hole table are not here.
