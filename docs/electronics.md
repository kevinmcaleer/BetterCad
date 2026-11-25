# Electronics

The electronics workspace (epic #606): draw a schematic, push it to a PCB, and get a 3D board in the model, all kept in
step. This page is for people working on the code. Millimetres everywhere, x to the right, y up, angles anticlockwise.

For people using it: [the guide](electronics-guide.md), [ordering a board](electronics-ordering.md) and the lesson
[Your first board](lessons/your-first-board.md). The guide opens from Help, from the empty schematic and from Electronics guide
in the command finder (#668).

## What we reuse and what we wrote (#614)

Checked 2026-11-24. Licence notes are a reading of the published terms, not legal advice.

| Piece | Licence | Decision |
| --- | --- | --- |
| KiCad symbol, footprint and 3D model libraries | CC-BY-SA 4.0 with an exception: designs and generated files that use them are free of share-alike; a redistributed library pack keeps the licence and its credits ([terms](https://www.kicad.org/libraries/license/)) | **Reused** as the source of the starter library (Kev, 2026-11-24). The pack stays CC-BY-SA with credits; our code stays MIT; boards people make are theirs |
| KiCad file formats (`.kicad_sym`, `.kicad_mod`, `.kicad_sch`, `.kicad_pcb`) | Open, documented s-expression text | **Read and written** by our own small reader. No KiCad code is used |
| tscircuit (circuit-json, autorouter, Gerber writers) | MIT | **Not a dependency.** Its model is built for circuits written as code and regenerated; ours is edited by hand and kept in step by ids, and adopting circuit-json as the core would mean translating on every edit. Its autorouter is the candidate for #647 |
| KiCanvas | MIT | **Reference only**, for how KiCad files are drawn. It is a viewer; we need an editor |
| tracespace | MIT | Looked at for the manufacturing preview (#657). A reader for the Gerber subset we write is small, so we write it; the preview then checks our writer with separate code |
| KiCad itself, Freerouting | GPL | **Never linked in.** Hand-off by file only |

**The data model is ours** (`packages/electronics/src/model.ts`), plain JSON in the model file, with KiCad import and
export at the edges.

**Drawing.** A routed board has tens of thousands of segments and pads; SVG, which the drawing sheet uses, does not
hold up. The schematic and the board draw on a 2D canvas (`CanvasRenderingContext2D`) with their own pan and zoom, and
redraw only when something changes. Canvas was picked over WebGL because text, dashed lines, round caps and joins come
free, it needs no shaders or tessellation of thick lines, and it costs nothing in the bundle. If a very large board
ever needs it, the same draw list can be fed to WebGL later.

## One design, three views

A model keeps one electronics design, under `document.electronics` (Kev, 2026-11-24: in the model file, one board per
model). The schema number did not change: a file without it is exactly as it was.

```
ElectronicsDesign
  defs      the design's own copy of each component it uses, by key
  parts     R1, C1, U1… each pointing at a def and one of its packages
  sheets    schematic sheets: placed symbols, wires, junctions, labels, no-connect marks
  board     outline, placements, tracks, vias, pours, holes, text, rules   (made by Push to PCB)
  checks    rule levels and waived results
```

- A **component** (`ComponentDef`) is a symbol, the packages it comes in (a footprint, a pin map and a 3D model each),
  and supplier part numbers. A design copies in each component it uses, so it opens offline and never breaks when a
  library changes.
- A **part** (`Part`) is one R1. Its symbols on the sheets and its footprint on the board all point at its id, which is
  what keeps the three views looking at the same thing.
- **Power symbols** (GND, 3V3) are parts whose symbol is marked `power`. They never reach the board; their value names
  the net their pin sits on.
- The **3D board** is a timeline step that builds a component from `board`. Electronics edits are undoable but are not
  steps.

## Nets

`netlist(design)` works the nets out from the sheets each time; they are not stored.

- Wires join at their ends. An end or a pin that lands part way along a wire joins it.
- Wires that only cross do not join without a junction dot.
- Labels with one name join, on a sheet or across sheets. So do power symbols with one value.
- A net is named by a power symbol if it has one, else a label, else from its first pin: `Net-(R1-2)`.
- Pins with nothing on them and no no-connect mark are reported as floating; wire ends in mid air as open ends.

## Parts and libraries

What a component holds, the starter library, where its parts come from and how to rebuild it are in
[electronics-library.md](electronics-library.md). `packages/electronics/src/library/pack.ts` is the pack format and its
search; `@bettercad/electronics/kicad` reads KiCad's `.kicad_sym` and `.kicad_mod` files. The Components panel
(`web/src/electronics/Components.tsx`) fetches the starter pack the first time it opens.

## Keeping the board in step

`boardChanges(design)` compares the schematic with the board and returns a change list; `applyChanges` applies it as
one edit. Nothing moves or goes without being listed first.

| Change | What it means |
| --- | --- |
| `make-board` | There is no board yet |
| `add-part` | A part has no footprint on the board; it is set out to the right of the board |
| `remove-part` | A footprint's part is gone from the schematic |
| `change-footprint` | A part's package was changed |
| `rename-net` | A net with copper on it has a new name; the copper follows. Told from a deleted net by its pins |
| `dead-net` | A net is gone but copper still uses its name. The copper stays until it is removed by hand |
| `no-footprint` | A part has no package, so the push stops |

The board remembers each net's pins from the last push (`board.synced`), which is how a renamed net is told from one
that was deleted.

## The workspace in the app (#617 to #620)

`web/src/electronics/` holds the views. The shell imports only `ui.ts` (the view-state store `eui`: which view is open,
the tool, the selection, the layer) and `actions.ts` (`showView`); everything else is one lazy chunk,
`Electronics.tsx`, with its own line in `budgets.json`.

- **A view covers the 3D view** the way a drawing's sheet does. While one is open the command scope is `electronics`:
  only the views' commands, files, themes, help and undo apply, so the views reuse the model's keys (1, 2 and 3
  switch between Schematic, PCB and 3D). The view registers its commands when it mounts and takes them away when it
  goes.
- **`Canvas2D`** is the shared canvas: scroll or pinch zooms, right-drag or a finger on empty space pans, and the tool
  in charge gets everything else in millimetres. It puts `data-view="scale ox oy"` on the canvas so a browser test
  can click a place on the drawing (`web/e2e/lib/electronics.ts`).
- **Layout**, as picked on 2026-11-24: the switcher top centre (full width on a phone) with a dot on PCB when the
  board is behind; the browser left and the part card right as the usual floating cards; Layers bottom right on the
  board, one chip on a phone; a status strip along the bottom where the timeline sits; on a phone the tools are one
  scrolling row along the bottom. `.bc-ec-clear` is a hidden box with the cards' insets, measured so Fit centres the
  drawing in the room the cards leave.
- **Edits** go through `onDesign`, which wraps a design change as a model change for the history store, so undo and
  redo work as everywhere else. Colours are the `ec-*` tokens, read from CSS when the canvas draws.

## Drawing a schematic (#631 to #633)

The edits live in `packages/electronics/src/edit.ts`, each a function from a design to a new design.

- **Copy, paste and duplicate.** `copyFromSheet` takes the picked symbols, wires, labels and marks as a `Clip` with
  the components they use. `pasteOnSheet` puts a clip down with fresh ids and fresh references (R4 becomes R5). The
  clip is kept in the browser's storage too (`clip.ts`), so it pastes into another model or another tab. Ctrl+C,
  Ctrl+V and Ctrl+D; Duplicate is also a tool, for touch screens.
- **Replace** (`replace.ts`, loaded with the Components card): with one part picked on the sheet, the card of the
  part picked in Components offers Replace. Wire ends move to the pin of the same name, or failing that the same
  number, and the pins that had a wire and found no match are listed.
- **Wires follow.** Moving a part stretches the wires on its pins; dragging a wire on its own brings the ends of the
  wires that meet it along. Hovering a wire or a label lights its whole net, and the status strip names it
  (`netAt` on the netlist).
- **Names and values.** `renumber` names every part again by position, sheet by sheet, top to bottom then left to
  right, as one undo step. `tidyValue` reads engineering shorthand on resistors, capacitors and coils when you leave
  the field: 4k7 is 4.7 kΩ, 100n is 100 nF, 2R2 is 2.2 Ω. Anything it does not recognise stays as typed.
- **The part card** shows the package with a preview, the LCSC and maker's part numbers, and Fitted. The **Parts
  table** (T) lists every part to change many at once; a column pasted from a spreadsheet fills the rows below.

## The rules check (#634)

`packages/electronics/src/erc.ts`, imported as `@bettercad/electronics/erc` so it loads only when the Checks card
opens or a push is about to happen. `check(design)` returns results in plain words, each with what to do about it.

| Rule | Starts as | Finds |
| --- | --- | --- |
| `pin-open` | Error | A pin with nothing on it and no Not connected mark |
| `output-clash` | Error | Two outputs, or power outputs, on one net |
| `input-undriven` | Error | An input on a net where nothing can drive it |
| `ref-duplicate` | Error | Two parts with one name |
| `no-footprint` | Error | A part with no package |
| `power-undriven` | Warning | A power pin on a net with no power output and no power symbol |
| `wire-open` | Warning | A wire that ends in mid air |
| `net-one-pin` | Warning | A net with a single pin on it |
| `label-once` | Warning | A label no other label or power symbol shares |
| `net-two-names` | Warning | A net carrying two different names |

A power symbol counts as a power source, so a board fed from a connector needs no extra flag: put 3V3 or GND on the
net. Each rule's level (error, warning, ignore) is kept in `design.checks.levels` when it differs from the table.
A single result can be waived with a note (`design.checks.waived`), keyed by the rule and the pins, parts or names it
is about, so the waiver lasts until that spot changes. The check also runs when Push to PCB opens, which says what it
found and lets you carry on. Each rule has a fixture that breaks it in `erc.test.ts`.

## Exporting a schematic (#635)

Export saves a PDF, an SVG or a netlist. The PDF and SVG reuse the drawing workspace: `sheetScene.ts` lays the
schematic on a drawing sheet (A4 or A3 landscape) with the frame and title block of `web/src/drawing`, as the same
`Scene` of lines and text the drawing writers take. The title block is filled from the model's name, the signed-in
person and today's date. The diagram prints at 2:1 or 1:1 when it fits and steps down when it does not, and the
title block says which. SVG text is text; a PDF's letters are outlines, as on drawings, so it looks the same
everywhere. The netlist (`kicad/netlist.ts`) is KiCad's own format, with each part's value and footprint and each
net's pins. The writers load when Export is pressed.

Left for later: sheets beyond the first (#636), hand-drawn text and shapes on a sheet, and buses.

## Laying out a board (#637 to #643)

The board's code is in `packages/electronics/src/pcb`, imported by subpath (`/pcb/copper`, `/pcb/route`,
`/pcb/rules`, `/pcb/pour`, `/pcb/state`, `/pcb/outline`, `/drc`) so it loads with the PCB view or the card that needs it.

**Copper as shapes** (`copper.ts`). Every piece of copper is a core (a point, a line or a convex outline) grown by a
radius: a via is a point, a track a line, a rounded pad a rectangle with its corners pulled in. `gap(a, b)` is the
distance between the cores less both radii, which is exact for every pad shape we have. `copperGroups` joins pieces of
one net that touch on a shared layer, so the ratsnest (`boardState` then `ratsnest`) leaves out pads that copper
already connects, through vias and across layers.

**Routing** (`route.ts`, the Route tool, W). Click a pad, a via or a track to start; each click lays a piece with one
45° bend (`corner45`), bent whichever way is clear; a click on the net's own copper ends the track. V or Swap side
drops a via and carries on on the other layer. The width comes from the net's class, else the board's rules, or from
the Width list. With Keep clear on, `blockers` stops a piece that would come closer to another net, a hole or the edge
than the rules allow, and says what is in the way; turn it off to route anywhere and let the board check find it.
Pieces laid one after another become one track. There is no push and shove (#646) and no autorouter (#647).

**Placing.** Drag parts on the grid (0.1 to 2.54 mm, in Layers), or pick one and type X, Y and turn in the part
card. Lock (K) pins parts down; with several picked, the card lines them up or spaces them evenly. A part picked on
the schematic stays picked on the board.

**Holes and text.** Hole (H) adds an M3 mounting hole; the card changes the screw size, the drill and whether it has
a copper ring. Text (T) writes on the silkscreen of the side being worked on.

**Board setup** (B). Width, height and corner radius of a rectangular board (`roundedOutline`), thickness, solder
mask and silkscreen colours, the rules and the net classes. A net class gives its nets a track width and clearance of
their own; a net is in one class at a time.

**Rule presets** (`presets.json`). A board house's limits are data: the numbers, the page they were read from and
the day they were read. `ours` lists the fields that are our working values (clearance, track width, via size)
chosen above the house's minimum. Adding a house is an entry in that file. The card links the source and says to
check it before ordering, because the houses change their pages.

## The board check (#644)

`pcb/drc.ts`, imported as `@bettercad/electronics/drc`. `checkBoard(design)` returns results in the same shape as the
schematic's check, and levels and waivers are kept in the same `design.checks`, so one card shows either.

| Rule | Starts as | Finds |
| --- | --- | --- |
| `short` | Error | Copper of two nets touching |
| `clearance` | Error | Copper of two nets closer than the larger of their clearances |
| `unrouted` | Error | A net with connections still to route |
| `behind` | Error | The board not yet updated from the schematic |
| `edge` | Error | Copper closer to the edge than the rules allow, or over it |
| `off-board` | Error | A part or a mounting hole that is not on the board |
| `track-width` | Error | A track narrower than the narrowest allowed |
| `hole-size` | Error | A hole smaller than the smallest drill |
| `ring` | Error | Too little copper round a pad's, via's or plated hole's drill |
| `hole-near` | Error | Two holes too close together |
| `keepout` | Error | A track or a part inside a keep-out |
| `courtyard` | Warning | Two parts on one side whose outlines overlap |
| `track-open` | Warning | A track end that reaches no copper of its net |
| `dead-net` | Warning | Copper on a net the schematic no longer has |
| `silk-size` | Warning | Silkscreen text smaller than prints well |
| `pour-empty` | Warning | A pour that fills nothing, or reaches none of its net's pads |

A part's own pads are never checked against each other; that is the footprint's business. Pairs are found with a
sweep along x, so a busy board stays quick, and the check runs in the page as the board changes. Each rule has a
board that breaks it in `pcb.test.ts`.

## Pours, keep-outs and the board's shape (#638, #641, #642, #645)

**Pours** (`pcb/pour.ts`, the Pour tool, P). Click the corners of an area, or press Whole board, to fill it with
copper on one net. The fill is never stored: it is worked out from the board each time (`boardState`), so it is
always up to date for the view, the board check and, later, the Gerber files. It has two forms. `pourShape` is exact
geometry to paint in order: the area cut to the board, rings round the pour's own pads knocked out, spokes laid back,
then every other net's copper, the edge, bare holes and keep-outs knocked out, each grown by the clearance it needs.
`pourFill` is the same fill on a grid of 0.1 mm or coarser, which says which pieces of the pour join which pads and
which pieces are islands that reach nothing; islands are dropped. Pads a pour joins need no track, and the ratsnest
and the board check both know. The card sets the net, the side, spokes or solid joins, and which pour fills first
where two overlap. `pour-empty` (a warning) finds a pour that fills nothing. Spokes are set per pour, not per pad.

**Keep-outs and cut-outs** (the Keep-out tool, O). The same corner-by-corner drawing makes an area tracks, vias and
pours stay out of (parts too, if ticked in its card), or a hole of any shape cut through the board. Route stops at a
keep-out when Keep clear is on, pours flow round it, and the board check lists what sits in one. Areas are picked by
their edge and can be dragged or deleted; to change a corner, draw the area again.

**An outline from a sketch** (`pcb/outline.ts`). When the model has a sketch with a closed shape, Board setup offers
it under Shape. The sketch's biggest closed shape becomes the edge and the shapes inside it become cut-outs, so the
sketch tools, sizes and parameters shape the board. The board's bottom left corner stays where it is. The board
remembers which sketch it follows; when the sketch's shape changes, Board setup says so and Update the outline takes
the new shape. Arcs become short straight runs.

**Back to the schematic** (#645). The board and the schematic are one design in one file, so a board change that the
schematic should know about is made to both in the same undo step. Renumber on the board names parts by where they
sit (top side first, in rows from the top, left to right) and the schematic's names follow. Delete on a part asks
first, then takes it off the sheet as well. A part's name can be hidden on the silkscreen from its card.

Left for later: dragging a track's or an area's corners, an outline from a face or a DXF file (there is no DXF
import yet), spokes per pad, pin and gate swapping (no component marks pins as swappable yet), pictures and fiducials
on the silkscreen.

## The board in 3D (#649 to #654)

The board is in the model as one **Board step** on the timeline (`packages/kernel/src/board.ts`). A model has one
board, so it has at most one Board step. The step holds only where the board stands; everything else is read from
the design each time the model builds, so a layout change rebuilds the board and nothing else, and there is nothing
to keep in step by hand. The step is added in the same undo step as the change that first makes the board; Board
setup has Add the board to the model for a file whose step was deleted.

`boardSolid` (`pcb/solid.ts`) turns the design into plain numbers: the outline and cut-outs, the holes worth
drilling, the thickness, the mass (FR4 at 1.85 g/cm³, with copper taken as covering a third of each side) and a box or a cylinder for each
part from its package's body size. The kernel builds the board as one prism whose profile has every cut-out and hole
as an inner loop (`pierced`), which is why a board with 300 holes builds in under 3 s where 300 cuts took most of a
minute. Holes under 0.5 mm are left out of the solid, and so are holes that break the edge or each other; the
picture still shows them. Bodies are named by reference (R1, U3), stand on their own side of the board, and belong
to one component named Board, so joints, Move, Hide and the clash check treat it as any other component.

The bodies are reference bodies that draw solid (`pcb` on the part): they are there to design round, they do not
print, and a slicer export leaves them out. To send the board to other CAD, right-click its bodies and choose
Export; STEP keeps one body per part with its name. The clash check sees them when Include references is on.

**Copper and silkscreen** (`web/src/electronics/boardPicture.ts`). Each side of the board is painted once per design
with the PCB view's own drawing code in the materials' colours (mask, bare pads, silkscreen) and laid on the board's
top and bottom faces as a picture, the way decals are. Tracks are never made solid. The path-traced render does not
draw pictures on faces yet, so a render shows the board and its parts without the copper.

**A board that sits in its case** (#653). A board that takes its outline from a sketch stands on that sketch's
plane, on the shape it was drawn from, so drawing the board's shape inside an enclosure puts the board there. The
step's own position then moves it from the sketch (say 3 mm up, onto standoffs). The board's faces and edges take
sketches and Auto project like any body's, which is how a case is fitted to it.

Left for later: dragging a part in the 3D view (move it in the PCB view; the model follows), a hole cut through the
board in 3D becoming a board hole, the Connector
opening and Standoffs under the board tools (#652; project the board's holes and use Mount), a board started from a
face, and the copper in a path-traced render.

## Files for a board house (#655 to #661)

Everything a board house needs comes out of `packages/electronics/src/fab/`, as text and rows with no DOM, and is
checked by reading the files back.

**Gerber** (`gerber.ts`). One RS-274X file per layer with X2 attributes, in millimetres, format 4.6: top and bottom
copper, mask, paste and silkscreen, and the outline. Every file is drawn looking down on the top of the board.
Pads are flashed with apertures: circles, rectangles and obrounds as they are, and a macro (two bars and four
discs, or a turned rectangle) for a rounded pad or one at an odd angle. Tracks are drawn with a round pen, and
copper carries its net (`.N`), pads their part and pin (`.P`). The outline is drawn as closed paths with arcs kept
as arcs. Mask openings are the pad grown by the mask margin; vias stay covered. The silkscreen has the mask
openings taken back out of it, so ink never lands on a pad.

A pour is painted the way the screen paints it, with dark and clear polarity in the same order: the area, the
rings round its own pads out, the spokes back in, then everything it keeps clear of out, and last the islands the
fill dropped. What lies outside the board is cleared with one area that has the board as a hole in it. The format
has no way to clip one pour's clearing to its own area, so two pours on different nets on one side that run into
each other cannot always be painted truly; `pourClashes` finds that case and the order card refuses to export it.

**Text** (`font.ts`). Board houses are sent lines, not fonts, so silkscreen and copper text is drawn with our own
stroke font: capitals, digits and common marks on a 4 by 6 grid, small letters as small capitals. The PCB view
still draws text with the screen's font, so the preview is the place to see the text that will be printed.

**Drill** (`drill.ts`). Excellon in millimetres, plated and bare holes in separate files, finished sizes, the same
coordinates as the Gerbers. A slot is a routed slot (`G00`, `M15`, `G01`, `M16`). `tools` is the drill table.

**Parts lists** (`parts.ts`). The bill of materials groups fitted parts whose component, value, package and part
numbers all match. A part's own supplier numbers win over its component's, field by field. The pick and place list
has every fitted part's middle, side and turn (anticlockwise, seen from the top), with a component's own
corrections (`pnp`) added in the file only. Part numbers are typed or pasted in the parts table, which opens from
the order card.

**The order pack** (`pack.ts`, `houses.json`). Order the board, in the PCB view's tools, picks a board house and
gives the Gerber and drill files in a zip of their own, then the parts list and the pick and place list as CSV or
XLSX (`web/src/electronics/xlsx.ts`, a workbook written by hand: five small XML files in a zip). Each house is data:
its columns and headings, which part number it needs, the pages they were read from and the date. Where a page
names a field but not the exact heading, the house's notes say so. The card shows what an order form asks (size,
layers, smallest track, gap and hole) and a checklist; only an open outline or clashing pours stop the export.
Nothing is uploaded: a link opens the board house's site.

**The preview** (`read.ts`, `web/src/electronics/FabPreview.tsx`). A small Gerber and Excellon reader draws the files
that were just written, layer by layer, from the top or the bottom, with layer ticks, zoom and a two-point measure.
It draws from the files, never from the design. It opens any Gerber zip dropped on it too; step and repeat and
aperture blocks are not read, and it says so when a file uses them. `inkAt` asks whether a file leaves a mark at a
point, which is how the tests check clearances, spokes and that drill hits land on copper.

Left for later: a real upload to each house's quote page to confirm the headings and how bottom parts are turned
(#660; neither house's page says), a pick and place preview showing pin 1 (#659), a realistic board picture in the
preview, live stock and prices (#661), LCSC numbers filled in for the starter library, and panels (#662).

## The sample board (#666)

The Pico servo board (`packages/electronics/src/sample.ts`; Open the sample board, on an empty schematic, or `#/sample/pico-servo-board`) is a carrier
for a Raspberry Pi Pico that drives two servos: two rows of 20 sockets, two three-pin servo headers, a two-pin 5 V
input, a power LED with its resistor and a capacitor across the supply. It is built from the same calls the tools
make (place a part, label a pin, push to the board, route a track, pour copper), with fixed ids so it comes out the
same every time.

It is also the main fixture: `sample.test.ts` holds it to both rules checks with nothing found, to a whole order pack
with nothing blocking, and to goldens of its Gerber, drill, parts list and pick and place files
(`fab/golden/sample.*`). In the model it stands on four standoffs over a printed base, so the sample shows the board
as a step on the timeline too. The `@journey` test in `web/e2e/electronics.spec.ts` opens it, finds the board in the
model, and takes it as far as the preview of the files.

What it is not, yet: the issue asked for a motor driver, a Qwiic connector and a power switch. Those parts are not in
the starter library, so the sample keeps to parts that are. Its order pack has been read back by our own reader and
by nothing else: nobody has uploaded it to a board house's quote page.

## Out to KiCad (#664)

Export, in the schematic, has a KiCad format: the whole design as a KiCad project in a zip
(`packages/electronics/src/kicad/export.ts`, `kicadProject`). It holds the schematic (one file a sheet), the board, a
symbol library and a footprint library with every part the design uses, the two tables that tell KiCad where the
libraries are, the project file with the board's rules and net classes, and `CREDITS.md`, which says where each part
came from. The files are KiCad 7's formats, which KiCad 7, 8 and 9 open.

What changes on the way out:

- KiCad's schematic and board run y down, so both are turned over; parts on the bottom are flipped the way KiCad
  flips them (top to bottom, half a turn from ours).
- A wire that something joins in its middle is cut there and gets a dot: KiCad joins wires only at their ends.
- With more than one sheet, the first is the root and the others hang off it as sheet boxes; labels go out as global
  labels, so nets with one name still join between sheets.
- A power symbol carries its net's name on its hidden pin, where KiCad 7 reads it, and as its value, where KiCad 8
  and 9 do.
- Pours go out as zone outlines. KiCad fills them itself (Edit, Fill all zones). Keep-outs go out as rule areas.
- Ids are made from the design's own, so the same design always writes the same files.

How it is checked: `export.test.ts` reads the libraries back with our own KiCad readers and holds the sample's
schematic and board to goldens. `kicadCli.test.ts` goes further where KiCad is installed (`kicad-cli`, KiCad 7 or
later; CI has none, so it is skipped there): KiCad reads the exported schematic and writes its netlist, which must
have our nets, pin for pin and name for name; it plots the board's copper, which must lie where ours does on both
sides; and it writes the drill files, which must have our holes. Both the sample and a design made to turn
everything every way (`kicad/fixture.ts`: mirrored and turned symbols, a part with two units, power symbols, wires
that join every way, two sheets, parts on both sides at odd angles) pass against KiCad 7.0.11. Nobody has opened the
files in KiCad 8 or 9 yet, or looked at them on screen: the checks are on nets, copper and holes, not on how the
drawing looks.

## In from KiCad (#663)

Open project, in the schematic's tools (and on an empty schematic, and in the command palette as "Open a KiCad or
Eagle project"), reads a KiCad project into the model: pick every `.kicad_sch`, the `.kicad_pcb` and the `.kicad_pro`
(`web/src/electronics/OpenProject.tsx`; the reader is `packages/electronics/src/kicad/project.ts`,
`importKicadProject`, a chunk that loads when files are first picked). The dialog says what it found and lists what
did not come across before anything changes. Opening replaces the model's schematic and board in one undo step, and
the Board step is added to the model so the board stands in 3D.

What it reads:

- The schematic, sheet by sheet. A hierarchy is flattened: each sheet box becomes a sheet of ours, the nets inside it
  take the sheet's name as a prefix, and its sheet pins become labels, so what was joined through the box is still
  joined. A sheet used twice comes in twice. Bus vectors (`D[0..7]`) are followed through sheet pins by name.
- Symbols come from the schematic's own copy of each (`lib_symbols`), so no KiCad library is needed. Units of one
  reference are one part. Power symbols stay power symbols; a hidden supply pin gets a label with its name, which is
  the net KiCad joins it to.
- The board: the outline from Edge.Cuts (lines and arcs joined into loops, the biggest is the outline, the rest are
  cut-outs), each footprint as it stands on the board (so a part takes its footprint from there, not from a library),
  tracks, vias, zones as pours, rule areas as keep-outs, text and drawings on the silkscreen, and mounting holes.
- The rules and net classes from the project file.
- A schematic on its own opens with no board. A part with no footprint on the board takes the starter library's
  footprint of the same name if there is one, and is listed if there is not.

What does not come across, each listed in the dialog when a project has it: copper on inside layers (the top and
bottom still come in), blind and buried vias, buses as drawings (their wires still join by name), group buses
between sheets, pictures, text boxes and shapes on a sheet, net class flags, dimensions, drawings on fabrication and
user layers, paste and mask drawings in footprints, symbols drawn in their alternate (De Morgan) style, and power
flags. Curved tracks come in as short straight pieces, within 0.5 µm of the curve. A pad whose copper sits off the
middle of its hole comes in with the hole in the right place and the copper centred on it, so the board check can
report a clearance there that KiCad does not. A board without its schematic does not open: the nets of a design here
come from its schematic. A local label and a global label with one name are one net here; in KiCad they can be two.

How it is checked: `kicad/project.test.ts` writes the sample and the fixture that turns everything every way out as
KiCad projects and reads them back: the same parts, nets, pads and board check, and nothing for Push to PCB to do.
`kicad/demos.test.ts` runs where KiCad and its demo projects are installed (CI has neither, so it is skipped there):
all 11 demos' schematics come in with exactly the nets `kicad-cli` finds, hierarchy and buses included, and the nine
2-layer demo boards come in with no shorts, nothing unrouted, nothing off the board and nothing behind the schematic.
That is against KiCad 7.0.11 and its demo files; projects saved by KiCad 8 and 9 have not been tried yet.

## In from Eagle and Fusion Electronics (#665)

Open project also takes an Eagle schematic and board (`.sch`, `.brd`), and Import parts in Components takes Eagle
libraries (`.lbr`). Eagle 6 and later write these as XML, and Fusion Electronics exports the same files; SparkFun and
Adafruit publish their boards and parts this way. The readers are in `packages/electronics/src/eagle/`: `xml.ts` (just
enough XML), `library.ts` (packages, symbols and device sets), `project.ts` (`importEagleProject`) and `import.ts`
(`importEagleLibraries`). Each loads when its files are first picked.

How Eagle's things become ours:

- A device set is a component. Each gate is a unit of its symbol. A pin takes the name of the pad its device joins
  it to as its number and keeps its own as its name; a pin on several pads gets a pin map. In a library, every device
  that has a package is one of the packages the component comes in. In a project, a part takes the package it stands
  on in the board, or failing a board, its device's.
- A supply symbol (no package, every pin a supply pin) is a power symbol, and names the net it sits on.
- Eagle lists each net's pins outright, piece by piece. The wires and dots come across as drawn. A net in more than
  one piece, or one somebody named, gets a label on each piece that no supply symbol names, so the pieces still join
  by name. Once the design is built its nets are held to Eagle's list, and any that came out joined differently are
  named in the dialog. That can happen where a wire of one net ends on a wire or pin of another, which joins them
  here and not in Eagle.
- Eagle turns a part and then mirrors it left to right; a design here mirrors and then turns, so a mirrored part's
  turn is taken the other way round. The same holds for parts on the bottom of a board.
- A pad or via with no size of its own gets the ring Eagle's design rules give it: a quarter of the drill, within 10
  to 20 mil for pads and 8 to 20 mil for vias, or what the board's own rules say.
- The board is measured from its outline's bottom left corner. The outline is the closed loop of the Dimension layer
  (curves kept), and other loops are cut-outs. Polygons on Top and Bottom are pours (rank 1 fills first, cut-out
  polygons are keep-outs for pours), tRestrict, bRestrict and vRestrict areas keep tracks out, and tKeepout and
  bKeepout areas keep parts out. tPlace and bPlace drawings and text are silkscreen.
- Clearance, least track width, least drill, copper to edge and least ring come from the board's design rules, and
  net classes with a width or clearance of their own come across with their nets.

What does not come across, each listed when a project has it: copper on inside layers, blind and buried vias, buses
as drawings, modules (design blocks) and what is inside them, frames and other symbols with no pins, dimensions,
drawings on document, stop and cream layers, and logos (packages with no pads). Curved tracks come in as short
straight pieces, hatched pours as solid ones, and octagon pads as round ones. A pad Eagle draws off the middle of its
hole ("offset") comes in with the hole in the right place and the copper centred on it. Assembly variants are not
read, apart from a part marked not populated. Files from Eagle older than 6 are binary and are refused with a note
to save them from a newer Eagle. A board without its schematic does not open.

How it is checked: `eagle/fixtures/turns.*` is a small Eagle 7 project written for the tests, with parts turned and
mirrored every way on two sheets and both sides of a board, a part with three gates, supply symbols, nets in pieces,
crossing wires, a curved edge and track, pours, restrict areas and holes. `eagle/project.test.ts` holds its nets,
parts, pads, copper, rules and notes. `eagle/kicadReads.test.ts` is a second opinion where KiCad is installed (CI has
none, so it is skipped there): KiCad's own Eagle reader opens the same board, and every pad must be where ours is,
the same size, on the same side and net. That confirms the turns and mirrors on the board; the schematic's follow the
same rule and are held to Eagle's own net list.

One real file has been opened: a schematic saved by Fusion Electronics (file version 9.7.0, 2026-11-24), a Pico W
robot board with ten parts from four libraries. Its nets matched Eagle's own list pin for pin, and the parts list came
out with the same lines, references, values and packages as Fusion's own BOM export. It showed two things the test
file had not, both now in `eagle/project.test.ts`: Fusion writes a net's name just past the end of a short wire,
joined to nothing, so such a name is moved onto the wire's free end; and a part with no value of its own shows its
device's name, unless the device says the value is yours to give. No board saved by Eagle or Fusion, and no SparkFun
or Adafruit project, has been opened yet.

## Tests and help (#667, #668)

- **Fixtures.** `fixtures/electronics/` keeps saved designs, each with a golden list of its nets, what Push to PCB
  would change, and what the two checks say (`packages/electronics/src/fixtures.test.ts`, in `npm run test:golden`).
  Nightly, each board's order files are written for every board house and read back, and each design goes out to
  KiCad and home again with the same nets. The Gerber, drill, parts list and pick and place goldens sit beside their
  writers in `fab/golden/`, and the KiCad ones in `kicad/golden/`.
- **In the browser.** `web/e2e/electronics.spec.ts` has the journeys (`@journey`, so they also run nightly in WebKit):
  two parts, a wire, Push to PCB, a routed track, a clean check and the saved order files; and the sample board from
  open to order. axe runs over the schematic, the board and the order pack in Light, Dark and Holoroom. The `@visual`
  tests picture the sample's schematic and board in each theme.
- **Budgets.** Nothing from electronics is in the shell beyond its commands and view state: the workspace, each card
  and each reader or writer is its own chunk (`budgets.json`).
- **Help.** [electronics-guide.md](electronics-guide.md) is the user guide,
  [electronics-ordering.md](electronics-ordering.md) says which file goes where at JLCPCB and PCBWay, and
  [lessons/your-first-board.md](lessons/your-first-board.md) is the lesson, written in the lesson format of #239. The
  lesson player is not built, so for now it reads as a page. The ordering guide's pictures are of our own order pack:
  nobody has uploaded a pack to either house from here, so there are no pictures of their order forms yet.

## What release 1 leaves open

- Release 2, by decision: more sheets with hierarchy (#636), shove routing (#646), an autorouter (#647), four layers
  and more (#648), panels and IPC-2581 (#662).
- Parts: custom pin shapes (#626), expressions in pad sizes (#627), a 3D view and pin snapping when lining up a part's body (#628),
  sharing a library (#629), the server's shared catalogue (#625), live stock and prices (#661).
- Eagle and Fusion files (#665): one Fusion schematic opens cleanly. No real board (.brd) has been tried.
- KiCad 8 and 9 files: the reader was checked against KiCad 7's own demos. Newer files have not been tried.
- A first real order: the order pack reads back in our own preview, and its copper and holes agree with what KiCad
  plots from the same board, but no board has been ordered with it.
