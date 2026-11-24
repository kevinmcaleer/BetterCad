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
