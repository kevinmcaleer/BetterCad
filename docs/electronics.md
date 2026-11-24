# Electronics

The electronics workspace (epic #606): draw a schematic, push it to a PCB, and get a 3D board in the model, all kept in
step. This page is for people working on the code. Millimetres everywhere, x to the right, y up, angles anticlockwise.

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
`/pcb/rules`, `/drc`) so it loads with the PCB view or the card that needs it.

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

A part's own pads are never checked against each other; that is the footprint's business. Pairs are found with a
sweep along x, so a busy board stays quick, and the check runs in the page as the board changes. Each rule has a
board that breaks it in `pcb.test.ts`.

Left for later: copper pours and thermals (#641), drawing keep-outs and cut-outs (#642), sending a change back to
the schematic (#645), an outline from a sketch, a face or a DXF (#638), and dragging a track's corners.
