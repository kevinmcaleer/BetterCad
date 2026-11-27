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
- **Turn and flip.** R turns the selection a quarter turn, X flips it left to right (`mirrorOnSheet`) and Y flips it
  top to bottom (`flipOnSheet`: the same flip and a half turn). The same keys work on a part still on the pointer.
- **Wires follow.** Moving a part stretches the wires on its pins; dragging a wire on its own brings the ends of the
  wires that meet it along. Hovering a wire or a label lights its whole net, and the status strip names it
  (`netAt` on the netlist).
- **Names and values.** `renumber` names every part again by position, sheet by sheet, top to bottom then left to
  right, as one undo step. `tidyValue` reads engineering shorthand on resistors, capacitors and coils when you leave
  the field: 4k7 is 4.7 kΩ, 100n is 100 nF, 2R2 is 2.2 Ω. Anything it does not recognise stays as typed.
- **The part card** shows the package with a preview, the LCSC and maker's part numbers, and Fitted. The **Parts
  table** (T) lists every part to change many at once; a column pasted from a spreadsheet fills the rows below.
- **Groups (#766).** Group (Ctrl+G) gathers the selection in a named, rounded outline (`Sheet.groups`, edits in
  `packages/electronics/src/groups.ts`). Clicking a member, the outline's edge or its name picks the whole group, so a
  drag moves it as one and wires to parts outside stretch. Double-click a member to go into the group and pick things
  one by one; Esc or a click outside comes back out. Double-click the name to rename it. A thing is in one group at
  most and groups do not nest. Deleting members shrinks the group, and a group left empty goes. Copy, paste and
  Duplicate sheet carry whole groups. The outline prints in the PDF and SVG, goes to KiCad as a box and text (KiCad
  has no schematic groups), and Find (Ctrl+F) finds groups by name.
- **Circuit blocks (#767-#771).** A block is a group with block facts (`PlacedBlock`): its tag (MD1), its connection
  points and a note per part. Inside nets are scoped to the tag ("MD1.VM") and shown without it, so copies never
  share a net; ground is named plainly. Points are net labels on the outline. Specs are `BlockSpec`s in
  `library/blocks.ts` (19 starter blocks), built by `buildBlock` and placed by `placeBlock` (`blocks.ts`); the
  Blocks tab in Components lists them. Picking a block shows its points, Connect to… and Join I2C (`connect.ts`).
  The rules check trusts a block's inside nets and treats an open point as the outside, then adds its own rules: a
  required point left open, a supply outside a power input's range, two power outputs joined, and an I2C line with
  no pull-ups or more than two.
- **Blocks on the board (#774).** Push to PCB sets each group's new parts out as one cluster (`clusters` in
  `sync.ts`): a block's `layout` guide (millimetres by reference in its spec, kept by part id on `PlacedBlock`) where
  it has one, packed close where not. Parked clusters and fully picked groups show their name in an outline
  (`boardGroups`). Pick the group (board inspector, or Ctrl+G on the board) picks a group's footprints, and turning
  several parts turns them round their middle so the group keeps its shape.
- **Your own blocks (#772).** Save as block on a picked group (`SaveBlock.tsx`) offers its nets as points
  (`pointChoices`: ticked when they leave the group or are a supply) and saves an `OwnBlock` (`ownBlocks.ts`): a
  `BlockSpec` with the parts it uses carried inside, so it places anywhere. Blocks live in Your library
  (`myLibrary.ts`, one store for every panel), go to the account inside the pack as `blocks`, and export as
  `.bcblock.json`. The group becomes a placed copy (`markAsBlock`); saving it again makes a new version. Not built:
  Edit block on its own sheet.
- **Block updates (#773).** A design keeps its own copy of each block. `STARTER_VERSIONS`
  (`library/blockVersions.ts`, kept in step by a test) and Your blocks' versions in storage (`blockVersions.ts`) let
  the schematic tag an old copy with Update without loading the shelf. `placeBlockKept` stores a print of the inside
  (`insidePrint`); `changedInside` compares it, so hand edits show as Changed and Update asks first. `whatChanged`
  lists a spec's `changes`, new values, parts and points; `updateBlock` (`blockUpdate.ts`) re-places the block in the
  same spot with the same tag, rejoins each joined point with a wire to where the new point is, lists points that
  are gone and leaves their wires, and keeps board places for parts of the same kind. A block saved from a plain
  group has no point labels, so wires joined straight to its pins are left for you after an update.
- **Folded blocks (#775).** `SchGroup.folded` is a view only: `foldedAway` lists the members to leave out of the
  drawing (all but the point labels), so nets and wires to the points never change. The canvas draws the outline
  filled, picks the group on a click inside the box and unfolds it on a double-click; the inspector has Fold to a
  box and Unfold, and the command list has Fold or unfold the block. The PDF prints folded blocks folded with "N
  parts inside". Not built: printing each folded block's inside on a page of its own, and a right-click menu (the
  schematic has none yet). KiCad gets the block flattened until hierarchy (#757) is in.

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
| `pin-conflict` | From the pin table | Two pin types that should not meet on one net (#738) |

Which pin types may share a net is a table (#738), `PIN_MEETS` in `erc.ts`, after KiCad's default: two outputs (or
power outputs) fight, an output on a three-state, open collector or open emitter pin is an error, an output with an
in-and-out pin and open collector with open emitter are warnings, a pin of no set type is a warning whatever it
meets, and a pin marked not connected is an error whatever it meets. The Checks card's rules show the table, and a
click steps a pair from fine to a warning to an error; changes are kept in `design.checks.pins` (keyed by the two
types in `PIN_TYPES` order) and Reset takes them out. Two drivers on a net still report as `output-clash`, one line
for them all; every other pair is `pin-conflict`, once for each pair of types on a net, at the table's level unless
the rule's own level was changed.

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

## Notes on a sheet (#733)

A sheet carries notes as well as parts and wires: text, lines, boxes and circles (`Sheet.notes`, the same `Shape` a
symbol is drawn from). The Draw group on the schematic ribbon has a tool for each: Text asks for its words where you
click, and the others take two clicks, a line's ends or a box's or circle's corners. Notes pick, move, copy, paste
and delete with everything else, and double-clicking a text note changes its words; clearing them deletes it. They
mean nothing to the nets or the rules check. They print on the PDF and SVG, and go to KiCad and back as its own
`text`, `polyline`, `rectangle` and `circle`; KiCad's text boxes and arcs are still dropped on the way in.

## The sample schematic (#729)

The Pico servo board's sheet reads in groups, each with a title note: the Pico's sockets, the servos and sensor
socket, the motor driver with its plugs, power in and the power light. Short runs inside a group are drawn as wires;
the runs between groups are joined by name. The groups are laid out in grid steps and drawn in closer so the sheet
reads at Fit on a 1440 px screen. Every fitted part carries its LCSC number, maker and maker's part number, read from
the part pages on jlcpcb.com on 2026-11-26, so its order pack has no part number warning. The L293DNE (C701118) was
pre-order on that date; MSKSEMI's L293DNE(MS), C19632281, was the in-stock part that fits.

A label used once is a warning unless it names a net already wired between two or more pins (KiCad does the same),
so naming a drawn wire for the board does not count as a slip.

Left for later: buses.

## More than one sheet (#636)

A schematic is one or more sheets (`packages/electronics/src/sheets.ts`). Nets join across sheets by name, exactly as
they do on one sheet, and a power symbol is its rail on every sheet, so a sheet is a page and nothing more: there is
no hierarchy and there are no sheet pins to keep in step. The netlist, the rules check, the parts table, Push to
PCB, the PDF export (a page a sheet) and the KiCad project (a file a sheet) already worked on every sheet; what this
adds is the way to make and move between them.

- **The sheet strip** (`SchSheets.tsx`, loaded apart) sits above the status strip: a tab for each sheet and a plus.
  Double-click or F2 renames, Delete deletes the sheet with its parts, Alt with an arrow moves it along, and
  right-click or a long press has them all. Page Up and Page Down go from sheet to sheet from anywhere in the
  schematic. A read-only model shows the strip only when there is more than one sheet.
- **Where a name carries on.** A label whose name is on another sheet, or is a power rail drawn there, says so
  beside it on the canvas ("SDA → Sensors"). Pick the label and the strip offers each of those sheets; choosing one
  goes there with its labels of that name picked and ringed.
- **A sheet as a block** (`duplicateSheet`). Duplicate copies a sheet to use again: a motor driver channel drawn
  once and placed four times. Each copy's parts get their own references. A name used only on that sheet is a net
  inside the block, so the copy gets its own ("OUT" becomes "OUT_2"); a name another sheet uses, or a power rail,
  stays joined, and is the block's way in and out. Rename those on the copy where each copy needs its own. A copy is
  a copy: it does not follow the sheet it came from.

Not built: buses (a group of signals drawn as one line), hierarchy with sheet pins, and blocks that stay linked to
their master.

## Laying out a board (#637 to #643)

The board's code is in `packages/electronics/src/pcb`, imported by subpath (`/pcb/copper`, `/pcb/route`,
`/pcb/rules`, `/pcb/pour`, `/pcb/state`, `/pcb/outline`, `/drc`) so it loads with the PCB view or the card that needs it.

**Copper as shapes** (`copper.ts`). Every piece of copper is a core (a point, a line or a convex outline) grown by a
radius: a via is a point, a track a line, a rounded pad a rectangle with its corners pulled in. `gap(a, b)` is the
distance between the cores less both radii, which is exact for every pad shape we have.

**Pad shapes** (`padShape.ts`, #744). Besides rectangles, rounded rectangles, ovals and circles, a pad can be a
`polygon`: its corners are in `points`, around the copper's middle and turned with the pad, with `w` and `h` its box.
A through-hole pad's copper can sit off the middle of its hole by `offset`, in the pad's own turn, as KiCad keeps it.
`boardPads` gives each such pad its copper's `centre` and its `outline` on the board, so the board check, pours,
Gerber (a polygon is a region, its mask opening the region with its edge drawn round by a pen twice the gap wide),
IPC-2581 (a `Contour`), the drawing and the 3D picture all use them. The ring check takes the offset off the ring.
In the footprint editor, Pad outline draws one corner by corner, a picked pad's shape can be set to Custom outline
and its corners typed, Make it an octagon cuts a pad's corners at 45°, and a through-hole pad's copper can be moved
off its hole. KiCad's custom pads come in as polygons: one `gr_poly` round the anchor as it is, any other mix of
pieces as the hull round them all. They go out as custom pads with a small round anchor, and an offset goes out with
the drill. `copperGroups` joins pieces of
one net that touch on a shared layer, so the ratsnest (`boardState` then `ratsnest`) leaves out pads that copper
already connects, through vias and across layers. A net can be given a colour and have its unrouted lines hidden
(`board.netLooks`, `setNetLook` in `netclass.ts`, #740) from its section in the inspector. The colours are a fixed
set drawn from theme tokens (`NET_COLOUR` in `drawBoard.ts`), so they follow the theme; a coloured net's tracks wear
it while the net is lit. Hiding only skips the drawing: the counts and the board check still see every connection.

**Routing** (`route.ts`, the Route tool, W). Click a pad, a via or a track to start; each click lays a piece with one
45° bend (`corner45`), bent whichever way is clear; a click on the net's own copper ends the track. V or Swap side
drops a via and carries on on the other layer. The width comes from the net's class, else the board's rules, or from
the Width list. With Keep clear on, `blockers` stops a piece that would come closer to another net, a hole or the edge
than the rules allow, and says what is in the way; turn it off to route anywhere and let the board check find it.
Pieces laid one after another become one track. Push and walk-round are below (#646, #753); the autorouter is #647.

**Placing.** Drag parts on the grid (0.1 to 2.54 mm, in Layers), or pick one and type X, Y and turn in the part
card. Lock (K) pins parts down; with several picked, the card lines them up or spaces them evenly. A part picked on
the schematic stays picked on the board.

**Selection filter** (#748). Pick, on the Layers card, says what a click or a drag box may take: parts (and their
pads), tracks, vias, pours (and keep-outs), text (and pictures) and holes (and fiducials and test points), and
whether locked parts count. `hitBoard` and `boxBoard` in `web/src/electronics/hitBoard.ts` take the filter, so a
click on something left out reaches what is under it. Routing still starts from any copper. A drag box takes the
parts it touches and anything else wholly inside it.

**Notes** (#749, `pcb/notes.ts`). `board.notes` holds dimensions, lines and text for whoever makes the board: never
copper, never silkscreen, nothing the board check measures. Dimension (in the Notes group) takes two points, which
snap as Measure's do, then a third for where its line goes; its length is worked out each time it is drawn
(`dimensionParts`), so moving an end keeps it right. Note line lays a line with each click until Esc. The Text tool
writes on the notes when its Write on list says so. Everything draws a note through `noteStrokes`: the Notes layer
on the board, the notes Gerber file (`notesFile`, X2 function `OtherDrawing,Notes`, with the edge for reference,
added to the order zip as `-Notes.gbr` and not stepped across a panel), and the first page of the assembly drawing.

**Holes and text.** Hole (H) adds an M3 mounting hole; the card changes the screw size, the drill and whether it has
a copper ring. Text (T) writes on the silkscreen of the side being worked on.

**Board setup** (B). Width, height and corner radius of a rectangular board (`roundedOutline`), thickness, solder
mask and silkscreen colours, the rules and the net classes. A net class gives its nets a track width and clearance of
their own; a net is in one class at a time.

**Rule presets** (`presets.json`). A board house's limits are data: the numbers, the page they were read from and
the day they were read. `ours` lists the fields that are our working values (clearance, track width, via size)
chosen above the house's minimum. Adding a house is an entry in that file. The card links the source and says to
check it before ordering, because the houses change their pages. A board notes the day its preset had been checked
when it took the rules (`presetChecked`). When the preset is checked again later and a number differs, the Board
card says which and offers **Update the rules** or **Keep these** (`presetChanges`, `keepRules`). Nothing changes
until you choose.

**Clashes while you place** (#639). While parts are picked on the board, `placeClashes` looks at just those parts
every time they move: over another part on the same side, off the board, hanging over its edge, or in a keep-out
for parts. The courtyards that clash are drawn in the warning colour and a line says what is wrong. It is the same
test the board check runs, so nothing shows here that the check would pass.

## Autoroute (#647)

`pcb/autoroute.ts` is our own maze router: no code is taken from tscircuit or Freerouting. It routes the connections
the ratsnest still shows, the short ones first, and only ever adds copper, so a track or via laid by hand never moves.

- **The grid.** Both sides of the board at 0.125 mm (coarser when the board is very large). For each net class a
  `Space` holds, for every cell and side, how much copper could sit there: the least gap to any other net's copper
  less the clearance between the two nets, to the board's edge less `copperToEdge`, and to track keep-outs. It keeps
  the nearest net and the nearest other net, so one map serves every net of a class. Copper is drawn in with a little
  spare, worked out so that two free cells always have room for the track between them.
- **The search.** A* over cells and sides, eight ways on, with a small cost for a turn, a cost of 4 mm for a via and
  double for crossing another net's pour. A via needs room on both sides, its hole clear of other holes by
  `holeToHole`, and may not sit on a pad. A run leaves and reaches a pad by a short piece with one 45° bend.
- **Measured twice.** Every run and via found is measured with `blockers`, the same test a hand-drawn track gets,
  before it is kept. A test routes the sample board from bare and asks the board check for an empty list.
- **Options.** `nets`, `parts` and `layers` (one side only, which also means no vias). A track through a pour can cut
  it in two, so the router looks at the ratsnest again, up to three times.
- **Fan-out** (`pcb/fanout.ts`, #746). `fanOut` gives each of a chip's surface pads that still has a connection to
  make a short track and a via: straight out along the pad, out and across at 45°, or in under the chip, the nearest
  place that keeps every rule, going round the chip in order so neighbours take turns. A pad left with no room tries
  again before its nearest neighbours, and a chip too fine for the net's vias is fanned again with the smallest via
  the rules allow (least drill plus two least rings), which is what a 0.5 mm QFN needs. Tests fan out SOIC (1.27 mm),
  TSSOP (0.65 mm), QFP (0.8 mm) and QFN (0.5 mm) clean. Before it routes, the autorouter fans out every pad it
  cannot leave from its grid (`fanout: false` turns that off), and a connection from a fanned pad starts from its
  via. Fan out on a part's card does it by hand.
- **In the app.** Autoroute on the PCB tools opens a card (`AutoRoute.tsx`). The router runs in a worker of its own
  (the board check's script, `boardCheck.worker.ts`, so the board's model is bundled for a worker once), which sends each route back as it is found; Stop ends the worker and keeps those. They go
  on the board in one edit, so one undo takes them out. If the board changed meanwhile nothing is laid.

It is for simple boards and for finishing off. It does not rip up and retry, push tracks aside, or route fine-pitch
pads that fall between grid lines; the connections it finds no way for are listed and left for you.

## Push, length and pairs (#646)

`pcb/push.ts` (loaded with the route tool or with Push on) and `pcb/shove.ts`, used by the route tool in `BoardCanvas.tsx`.

- **Push** (#646, #753). With Push on, a run that comes too close to another net's track or via asks `shove` for
  room. A via moves straight away from the nearest point of what pushes it, and the ends of its own tracks go with it.
  A track's piece in the way is cut so only the stretch beside what pushes moves, then slid sideways with
  `slidePiece` (#640) just far enough, with 45° pieces at each end; of several pieces too close, the one that lies
  most beside the pusher moves, so a piece met end on is never the one asked to go sideways. What moved pushes in
  turn, four deep at most. Pads, plated holes, text, keep-outs and the board's edge never move. Everything that moved
  is measured with `blockers` before it is kept, and the run and its pushes are one edit, so one undo puts them back.
- **Walk round** (#753, `walkRound`, `routeOn`). With Keep clear on, a piece that cannot go straight, the other way
  round its bend, or by pushing walks round instead: an A* search in eight directions on a grid over the ground
  between the two ends and 6 mm round it (no more than 60,000 cells, so the pointer never stalls), each piece of
  copper marking only the cells too close to it and the board's edge a wall. A small cost on each turn keeps the
  corners few, and the result is pulled tight to straight runs and 45° corners, then measured with `blockers`. With
  Push on it first walks round only what cannot move and pushes the rest aside.
- **Drag with push** (#753, `dragPushing`). With Push on, sliding a piece of track in Select pushes the tracks and
  vias it comes too close to, worked out from the board as it was when the piece was picked up; where there is no
  room the piece stays where it last fitted. The 1,750 part board drags and walks in well under a second.
- **Length.** The route bar shows the net's length as you go, the piece on the pointer counted, and against a target
  when one is typed. A track's card shows its net's length; typing a longer one puts flat-topped wiggles with 45°
  corners in its longest straight piece, on whichever side has room (`tuneLength`). Tuning only makes a net longer.
- **Matched lengths** (`pcb/match.ts`, #745, loaded when a track is picked). Pick tracks on several nets and press
  Match lengths: each net is tuned to the longest, within a tolerance (0.1 mm unless you type one), its wiggles in one
  piece when they fit and shared out over several when not (`matchLengths`). A track on one half of a pair shows both
  lengths and the skew, and Match the pair tunes the shorter one. The nets are kept as a group (`board.matched`, a net
  in one group at a time), and the board check's "Nets matched in length have drifted apart" warning says when later
  routing pulls a group further apart than its tolerance. Stop matching takes the group apart.
- **Pairs.** With Pair on, starting on a net whose name has a partner (D+ and D-, USB_P and USB_N, DP and DM, TXP and
  TXN) finds the partner's pad within 8 mm and routes both: you click the line between them, and `pairRuns` lays one
  track each side of it at the track width plus the clearance, mitred so the gap holds round every corner. Clicking
  a pad of either net lands both, on that pad and its partner's nearest. A pair stays on one side.

Not done: pushing vias, walking a push round a pad (a push that needs to go round one stops), and matching the two
lengths of a pair automatically (tune each track to the same target instead).

## Four and six layers (#648)

A board has two, four or six copper layers: `Board.copperLayers`, with the inner ones named `in1`, `in2` and so on
from the top down (`pcb/stack.ts`: `layersOf`, `layerName`). Everything that asked "top or bottom?" now asks
`layersOf(board)`.

- **Copper.** A through pad and a plated hole have copper on every layer, a surface pad on its own side, a track and
  a pour on their own layer. A via joins every layer unless it has a `span`, which makes it blind or buried
  (`viaLayers`, `viaKind`, `setViaSpan`). `copperOf` gives each piece its layers, so the board check, pours, the
  ratsnest and the routing tools follow with no code of their own. A plane is a pour drawn over the whole board on
  an inner layer.
- **The build.** `STACKS` holds one usual FR-4 build for each count, written by us: copper, prepreg and core, top to
  bottom. They are not a board house's own. `setStack` takes one (inner copper on layers that go is taken away, and
  `stackLoses` says how much first); the board keeps its thickness and `buildOf` fits the sheets between the copper
  to it. Board setup lists the build.
- **The check.** Two new rules: copper on a layer the board does not have (an error), and a via that does not go
  right through (a warning, since board houses charge more and some do not make them).
- **Routing.** L steps down through the layers and round to the top. Autoroute searches every layer, lays vias
  right through, and leaves an inner layer with a pour on it whole.
- **Files.** `gerberLayers(board)` adds a copper file for each inner layer, numbered down from the top
  (`Copper,L2,Inr`), named `.G1`, `.G2` in the order pack. Blind and buried vias are drilled in a file of their own
  for each span (`-L1-L2.DRL`, `Plated,1,2,Blind`). KiCad projects go out with `In1.Cu` and so on and `via blind`,
  and come back in the same; Eagle boards bring in the first four inner layers with copper on them.
- **3D.** The board is as thick as Board setup says. Inner copper is not modelled: only the outside shows.

Not done: board houses' own builds as presets. Their pages could not be read from here, and the numbers must come
from those pages. Controlled impedance, microvias and back-drilling are not part of this.

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

**Hatched pours** (#747). A pour's Fill can be Hatched, with a line width and a gap (`pour.hatch`). `hatchHoles` cuts
square openings `gap` wide on a grid of `width + gap` lined up with the board's origin, only where a whole line is
left round the area's edge; they are taken out just after the area, so spokes still cross them, on screen and in the
Gerber file alike, and the fill's grid leaves them bare so islands and joins stay right. The board check treats the
lines as tracks: lines narrower than the least track width are an error. KiCad zones go out and come in with
`(mode hatch)`, `hatch_thickness` and `hatch_gap` (hatching turned at an angle comes in square, with a note), and
Eagle's `pour="hatch"` polygons come in with their width and their spacing less the width as the gap.

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

**Text and silkscreen** (#642). The Text tool writes on the silkscreen; the text's card moves it to either side's
silkscreen or copper. Text in copper is real copper on no net: the board check measures to it, pours keep clear of
it, and it is drawn in the copper files with the same strokes. Text can have several lines. The files for the board
house cut the silkscreen away wherever it crosses a pad's opening, and the board check now says so first
(`silk-pad`, a warning): which part's name or which text loses ink, and over which pad.

**An outline from a face or a DXF file** (#638). Board setup's **Shape** list offers the model's sketches and, with
the 3D view's pick set to Faces, any flat face picked on a body. The board takes the face's edge, with holes through
the face as cut-outs, seen from outside the body (`faceShape` in `web/src/electronics/faceOutline.ts`, worked out
from the face's triangles). The face is kept by the name the kernel gives it (`outlineFrom.face`, "body|face name"),
so it is found again after the model changes; when its shape has changed the card says so and offers **Update the
outline**, as it does for a sketch. The face's plane is kept with it (`outlineFrom.frame`), so the Board step stands the board on the face in 3D, as a board from a sketch stands on its sketch; a body moved by a joint or a pose is not followed. Round cut-outs up to 10 mm across are offered as mounting holes (**Make them mounting holes**, `holesFromCutouts`, #653): they become drilled holes that can be sized for a screw, and a board that follows a sketch or a face keeps drilling them as it follows. **Shape from a DXF file** reads lines,
arcs, circles, ellipses and polylines with bulges (`dxfOutline` in `pcb/dxf.ts`), joins them end to end into closed
shapes and takes the biggest as the edge and the ones inside it as cut-outs. The file's units are honoured
(`$INSUNITS`), curves come in as short straight runs, and the card says what was left out: open shapes, splines,
text. A shape from a file follows nothing afterwards. BetterCad has no DXF reader for sketches yet, so this one is
the board's own.

**Sliding a piece of track** (#640). With one track picked, drag a piece of it and that piece slides sideways,
staying parallel to itself. The pieces either side keep their own directions and grow or shrink to meet it, so 45°
corners stay 45° (`slidePiece` in `pcb/slide.ts`). An end of the track sits on a pad or a via and does not move: a
short 45° piece is put in to reach the slid piece. The slide stops where a neighbour would have to turn back on
itself. Another track of the net that ends on a moved corner, and a via on one, go with it. With several things
picked, a drag moves them all as before.

**Big boards** (#640, #644). `bigBoard` (`pcb/big.ts`) makes a test board of any size. Measured in headless Chromium
on a board of 1,750 parts and 5,145 pieces of track: zooming and panning hold 60 frames a second, and each step of a
drag (a part, or a piece of track) takes 70 to 100 ms; before this work a step took 600 ms to a second. What changed:
the nets are read from the schematic once and kept while only the board changes, a wire's box is looked at before a
point is measured against it, the 3D model is left alone while the schematic or the PCB view covers it, and the
copper's groups and the ink over a pad check look at boxes first. The board check itself runs in a worker
(`boardCheck.worker.ts`), so the page stays free while a big board is measured; the last list stays up until the new
one arrives, and where a worker cannot start the check runs in the page. A 500 part board is checked in about 0.2 s
(`big.test.ts` holds both timings to a loose limit).

**Pictures on the silkscreen** (#642). **Picture** on the board's ribbon takes a PNG, JPEG or SVG file and prints
it as ink: dark, solid parts of the picture are ink, light or clear parts are bare board. It is kept in the design as
a bit a cell (`BoardPicture`, at most 200 cells across, `pcb/picture.ts`), so nothing is fetched later. Its card sets
the width (the height follows), the side, and **Swap ink and bare board** for a light logo on a dark ground; a note
says when its finest detail is thinner than the board rules print. It is drawn in the silkscreen file as filled
regions, flipped on the bottom so it reads from underneath, cut away over pads like any ink, and the board check
warns when it crosses one. Pictures go to KiCad as filled silkscreen polygons, a rectangle for each run of ink
(#751); they come back as silkscreen drawings, not as a picture.

**A pad's own way into a pour** (#641). A pour joins its pads with spokes or all round. One pad can differ: a
part's card lists its pads that are on a poured net, each with As the pour says, With spokes or All round
(`joins` on the placement, `setPadJoin`).

**Pin swap** (#645). A component marks pins that do the same job with the same word (`swap` on a pin: a resistor's
two ends are both "ends"). For a part with such pins, its card on the board offers **Swap pins 1 and 2** (or a list
of pairs when there are more). `swapPins` (in `swap.ts`) gives that one part its own copy of the component with the two pins in
each other's places: the wires on the sheet do not move and now reach the other pin, and the two pads take each
other's nets, all in one undo step. In the starter library resistors, unpolarised capacitors, inductors, ferrite
beads and fuses are marked, and the symbol editor's **Swaps with** field marks the pins of a part you draw. KiCad symbols have no such mark, so it is not written to or read from KiCad files.

Left for later: an outline from a face or a DXF file (there is no DXF
import yet), spokes per pad, gate swapping and pictures
on the silkscreen.

**Teardrops** (#743). Board setup has **Teardrops**, off unless you tick it (`Board.teardrops`). Like pours they
are never stored: `teardrops` in `pcb/teardrops.ts` works them out from the board each time. Where a track ends on
a pad or a via of its own net and layer that is wider than the track, and its first piece runs straight for at least
the pad's width beyond its middle, a four-cornered flare runs from the track's width out to 80% of the pad's narrower
side. One that would come closer to another net's copper than the clearance is left out, so teardrops never fail the
board check. The canvas paints them with the tracks and the copper files fill them as regions. They go to KiCad as
KiCad's own teardrop zones (`attr teardrop`, filled), and coming in, a teardrop zone, or a via or pad with KiCad 8's
`teardrops` set to enabled, turns the setting on.

**Dragging corners** (#742). The one picked track shows its bends as small squares, and a picked pour, keep-out or
cut-out shows its corners (`handlesOf` and `handleAt` in `hitBoard.ts`). A bend drags (`moveTrackCorner` in
`pcb/corners.ts`); a track's ends stay on their pads and vias, and a piece either side that would run at an odd angle
gets a 45° bend of its own next to the moved corner. With Keep clear on, the bend stops where the track would come too
close to other copper, and the status line says what is in the way. An area's corner drags (`moveAreaCorner`), a
press on its edge puts a new corner there and drags it (`addAreaCorner`; an arc it splits goes straight), and Delete
with a corner picked takes it away while the area keeps three (`removeAreaCorner`). Each drag is one undo step.

**Copy, paste and duplicate** (#741). Ctrl+C, Ctrl+V and Ctrl+D work on the board as on a sheet, for tracks, vias,
pours, keep-outs, text, pictures, holes, fiducials and test points (`pcb/clip.ts`, loaded the first time). A
picked part copies with the tracks and vias of its pads' nets that lie round the picked parts (`copyBoard`). Pasted
on its own (`pasteBoard`), the copy lands with its bottom left corner under the pointer and fresh ids. Pieces of
copper that touch are one run, and a run takes the net of the copper it lands on, or is on no net if that is none
or two nets; the status line says how many pieces are on no net. Parts are not pasted, since they come from the
schematic. Pick the same number of matching parts (the same footprints, paired in reference order) and paste: the
first stays put and the rest are laid out round it as the copied ones were, turned with it, and the routing
follows with each net swapped for the net of the matching pad. That repeats a routed channel in one undo step.
Parts on the other side from the copy's are refused with a note to flip them first.

**Stitching vias** (#737). A pour's card has **Via spacing** (5 mm unless you change it) and **Add stitching vias**.
`stitchPlan` (in `pcb/stitch.ts`, loaded only when asked) walks a grid that many mm apart, lined up with the board's
origin, and keeps a point only when this pour and another pour of its net on another layer both fill all round a via
there, at least one of them is joined to something already, and the via keeps its clearance from other nets'
copper, from every pad (its own net's too, so no via lands in a pad), from holes, other vias and the edge.
`addStitching` adds them in one edit, so one undo takes them out; after that they are ordinary vias on the net.
Asking again adds none where they already are. `pourFill` takes `{ islands: true }` for the fill a pour would have
once something joins it, as a bottom pour with nothing of its own on that side.

**Fiducials and test points** (#735). The Add group has **Fiducial** and **Test point**. Each is a round copper pad
of the board's own, with no part behind it (`Board.marks`, `pcb/marks.ts`), numbered FID1… and TP1…. `markPads`
puts them into `boardPads`, so the copper and mask files, the unrouted lines and the board check all see them like any
pad. Both are 1 mm with no paste. A fiducial has a mask opening twice its size (`maskMargin` of half its size, the
usual 1 mm dot in a 2 mm clear ring) and keeps other copper out of that ring (`copperOf` gives it the ring's size);
it is on no net and goes in the pick and place file, so the line's camera knows where to look. A test point clicked
onto a track or a pad takes that net, and its card picks another; a test point on a net and not routed shows in the
board check as a connection to route. Both go to KiCad as one-pad footprints, `Fiducial_<size>mm` and
`TestPoint_<size>mm` (smd, left off the parts list; test points off the position file too), and a one-pad round
surface footprint named Fiducial or TestPoint, or with a FID or TP reference, comes back in as one.

## Calculators (#739)

Calculators (on the Check group of the schematic and the Board group of the PCB) is a card of sums with no say over
the design, in `packages/electronics/src/calc.ts` (subpath `/calc`) and `Calculators.tsx`, both loaded when it opens.

- **Track width for a current** and **current a via carries**: IPC-2221 (2012), section 6.2, the fit to its
  conductor charts, I = k · ΔT^0.44 · A^0.725, with I in amps, ΔT the temperature rise in °C, A the cross-section
  in square mils, and k = 0.048 for outer layers, 0.024 for inner ones. The charts cover up to 35 A, 400 mil and 10 to
  100 °C. Copper is 34.79 µm per oz/ft². A via's barrel is a ring of plating (25 µm unless changed) round its hole,
  rated as outer copper, as Saturn PCB Toolkit and KiCad's calculator do. Use a width can set a net class's track
  width, rounded up to 0.01 mm; tracks at the class's old width follow, as they do from the inspector.
- **Resistor for an LED**: Ohm's law, R = (V supply − V forward) / I, rounded up to the next E24 value (IEC 60063)
  so the current only falls; the card says the current and power with that value.
- **Resistor colour bands**: IEC 60062, four bands (two figures) or five (three), both ways. The swatches are paint
  colours kept with the sums (`BAND_PAINT`), like the board's mask colours, not interface colours.

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

**True bodies** (#752, `pcb/bodies.ts`). Most starter parts are drawn as the part that comes back from the fab, in
boxes and cylinders worked out from the footprint and the package's size: a header's black strip and gold pins
through the board (a socket's tall housing with its tails underneath), a resistor's black body between tinned ends,
a capacitor in tan, an LED with its lens, a DIP on its standoffs with a lead through every pad, gull-wing leads from
SOIC, SSOP, TSSOP, MSOP and SOT pads up to the body, JST PH, XH and SH housings in natural white, a PCM12 slide
switch with its lever, tactile buttons, USB sockets, round LEDs and cans, TO-220s with their tab, and ESP32 modules
with the can over the chip and the antenna end bare. A resistor and a capacitor of the same size are told apart by
the reference's letters. Each material is a body of its own (`R1`, `R1.1`), so each wears its colour; the blocks are
gathered as they stand rather than joined (`gatheredShape` in `occt/catalogue.ts`), which builds the whole sample
board in under a second where joining a 20-pin header's pins took over one. The same part used many times is
meshed once, as before. Bodies are drawn in our own code (MIT) from sizes, so there are no files to fetch or credit;
a part no rule knows, or one with a STEP file or a robot catalogue part, keeps what it had. A connector opening is
still cut round the part's box. `header(pins, socket)` in the basics is a 2.5 mm pin header unless it is a socket.

The bodies are reference bodies that draw solid (`pcb` on the part): they are there to design round, they do not
print, and a slicer export leaves them out. To send the board to other CAD, right-click its bodies and choose
Export; STEP keeps one body per part with its name. The clash check sees them when Include references is on.

**Copper and silkscreen** (`web/src/electronics/boardPicture.ts`). Each side of the board is painted once per design
with the PCB view's own drawing code in the materials' colours (mask, bare pads, silkscreen) and laid on the board's
top and bottom faces as a picture, the way decals are. Tracks are never made solid. The path-traced render draws the
same pictures (#654): each is a thin sheet just over its face with the picture as its colour (`RenderBody.decals`,
`PathRender.picture`), cut with its body when a section is on and left off in the Paper style. Decals (#263) reach a
render the same way. A shot's picture is out of date once the board's design changes (`shotKey`).

**One mesh for repeated parts** (#650). The kernel meshes each shape a board's parts have once, where the shape is
drawn, and sets the triangles down for every part of that shape (`ModelBuilder.sharedMesh`, `moveMesh`): 50 resistors
cost one meshing and 50 moves of it. `ModelResult.shared` counts them.

**From the 3D side** (#651, `packages/kernel/src/boardmove.ts`, `web/src/electronics/board3d.ts`). Move or Turn on a
part's body in the 3D view changes where it sits on the board: the drag is read in the board's own plane, so the part
slides along the face and turns about its normal, and a lift or a tilt is dropped. The PCB view shows it moved, its
tracks stay where they were, and the board check flags what no longer joins. A locked part stays put and says why.
Dragging the board's own body moves the Board step, so every part comes with it and a board on a sketch or a face
stays on it. The Hole tool on the board's top or bottom face makes board holes (drilled through, at the screw's
ordinary clearance, without a printer's hole offset) in place of a Hole step, in one undo step; they are in the PCB
view and the drill file like any other.

**A board that sits in its case** (#653). A board that takes its outline from a sketch stands on that sketch's
plane, on the shape it was drawn from, so drawing the board's shape inside an enclosure puts the board there. The
step's own position then moves it from the sketch (say 3 mm up, onto standoffs). The board's faces and edges take
sketches and Auto project like any body's, which is how a case is fitted to it.

**Designing the case round the board** (#652). **Standoffs under the board**: the Mount tool, on a face the board
lies flat over, has **Under the board's holes** at the top of its Pattern menu. One pick puts a standoff under each
mounting hole, as tall as the gap up to the board, with the biggest screw that goes through the holes. The step keeps
`underBoard`, so each build reads the holes and the height from the board again (`standoffsUnder`) and the standoffs
follow a moved hole or a lifted board; when the board is no longer over the face they stay where they last were.
**Connector opening** (right-click a part on the board in 3D, or the command list): finds the nearest printed body
that one of the part's four sides looks at within 30 mm, and cuts the box round the part's body out through that
wall with a sliding fit (`connectorOpening` in `board3d.ts`). It is a Combine cut whose tool has `reach` (which side
of the part, and how far out), so the cut is made from the part each time the model builds (`openingBox`) and follows
the part along the wall; how far it reaches is as it was when it was made. A part whose body is a STEP file has no
box to cut round, and the step says so.

## Files for a board house (#655 to #661)

Everything a board house needs comes out of `packages/electronics/src/fab/`, as text and rows with no DOM, and is
checked by reading the files back.

**Gerber** (`gerber.ts`). One RS-274X file per layer with X2 attributes, in millimetres, format 4.6: top and bottom
copper, mask, paste and silkscreen, and the outline. Every file is drawn looking down on the top of the board.
Pads are flashed with apertures: circles, rectangles and obrounds as they are, and a macro (two bars and four
discs, or a turned rectangle) for a rounded pad or one at an odd angle. Tracks are drawn with a round pen, and
copper carries its net (`.N`), pads their part and pin (`.P`). The outline is drawn as closed paths with arcs kept
as arcs. Mask openings are the pad grown by the mask margin. Vias are covered (tented) unless Board setup says
Vias: Open (`board.viaMask`, #736), and one via can differ (`via.mask`, `viaOpen` in `pcb/stack.ts`); an open via
gets an opening the size of its copper ring grown by the margin, on each outer side it reaches. The silkscreen has
the mask openings taken back out of it, so ink never lands on a pad or an open via. The as-made preview reads the
files back, so it follows. KiCad 7 keeps one say for the whole board, `(pcbplotparams (viasonmask …))`, so a via
that differs from its board does not carry its own across; coming in, KiCad 8's `(tenting)` is read as well.

A pour is painted the way the screen paints it, with dark and clear polarity in the same order: the area, the
rings round its own pads out, the spokes back in, then everything it keeps clear of out, and last the islands the
fill dropped. What lies outside the board is cleared with one area that has the board as a hole in it. The format
has no way to clip one pour's clearing to its own area, so when two pours on different nets on one side run into
each other, painting the later one would cut copper out of the earlier one round its own pads and tracks (#750).
`cutPours` finds each pour that would be cut, and it is written after the painted ones as its finished fill instead:
`fillRects` turns its fill, on a grid of up to a million cells (no coarser than 0.05 mm where that fits), into
rectangles of copper with nothing cleared, so nothing drawn later cuts it and it cuts nothing. Each knock takes out
three quarters of a cell more than its reach, so no corner of a rectangle comes nearer than the rules allow. Its
edges are steps of one cell; the painted pours keep their exact edges. Any pours now export.

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

**As made** draws one side as the finished board looks, still from the files alone: the board's shape from the
outline file (`boardLoops` joins its lines into loops; the biggest is the edge, the rest are cut-outs), the mask
with copper a little lighter under it, bare metal where the mask opens over copper, ink kept off the openings and
the holes drilled through. The files do not say the mask colour, so it starts as the board's and can be changed.

**Pin 1** (#659) marks the pick and place list over the pads. `pinOnes` works from the list's own rows: a cross
where a row puts the part, a ring on pad 1 as the layout has it, and a dot where pin 1 lands taking the row as
written. A part with no correction has its dot in its ring. A component's own correction (a turn or an offset for
the line) moves the dot off the ring by exactly that much, so you can see what each correction does, top and bottom.

Left for later: a real upload to each house's quote page to confirm the headings and how bottom parts are turned
(#660; neither house's page says), live stock and prices (#661) and panels (#662).

**Common parts** (`common.ts`, `common.json`). The parts table offers LCSC numbers for everyday resistors and
capacitors: a part whose kind, value and package match a row of the checked list, and that has no number, can have
it filled in. The list is in `docs/electronics-library.md`.

## Panels, IPC-2581 and assembly drawings (#662)

- **Panels** (`fab/panel.ts`). The order card's Order a panel of boards takes rows, columns, how the boards join and
  the rails. Every Gerber file is written out once for each board, moved into place, rather than with Gerber's step
  and repeat, so every viewer (ours included) shows the panel as it will be made. Each copy starts dark with no
  object attributes left over. V-cuts: the boards touch, the lines run right across the panel between rows, columns
  and rails, and they go in a file of their own (`-VCUT.gbr`) as well as being where the boards meet; a board that
  is not a plain rectangle gets a warning. Tabs: a milled gap (2 mm unless changed) round each board and off the
  rails, a 3 mm tab in the middle of each side that faces another board or a rail (two on a side over 50 mm), the
  board's outline broken where each tab holds it, and a row of 0.5 mm unplated holes along each board's edge at the
  tab. Rails of 4 mm or more get a 2 mm tooling hole 3 mm in from each corner. These sizes are our own usual ones,
  not a board house's. The pick and place list stays the one board's.
- **IPC-2581** (`fab/ipc2581.ts`), revision C. Each layer's image is the Gerber writer's own, read back with
  `readGerber` (which now keeps each object's `.N` net) and written as IPC-2581 features: flashes as pads with a
  standard shape, macro pads as their pieces, draws as polylines, areas as contours, and a pour's clearances as
  negative sets in the order the Gerber paints them. On top: the board's build as the stack, the outline as the
  profile, a package for each footprint with its pins, the components, a logical net for each net with its pins, a
  drill layer for each span with its holes, and the parts list. Tests parse it and check that every reference is
  to something it defines and that the copper matches the Gerber's object for object. It has not been opened in
  another tool's IPC-2581 reader yet.
- **Assembly drawing** (`assemblyScene` in `web/src/electronics/sheetScene.ts`): Save the assembly drawing on the order card writes
  one PDF with a page for each side that has parts, on the drawing workspace's sheet with its frame and title
  block, through the drawing export's PDF writer. The board's edge and holes, each part's fab outline (or its
  courtyard), its pads, a dot on pin 1 for parts with more than two pads, and the reference. The bottom is drawn
  turned over, as you see it from below. It is a page to print, not a sheet you can edit in the Drawing workspace.

## The sample board (#666)

The Pico servo board (`packages/electronics/src/sample.ts`; Open the sample board, on an empty schematic, or `#/sample/pico-servo-board`) is a carrier
for a Raspberry Pi Pico that runs a small rover: two rows of 20 sockets, an L293D motor driver with a two-pin header for
each motor, two three-pin servo headers, a Qwiic socket for I2C sensors, a two-pin 5 V input through a slide switch,
a power LED with its resistor and a capacitor across the supply. It is built from the same calls the tools
make (place a part, label a pin, push to the board, route a track, pour copper), with fixed ids so it comes out the
same every time.

It is also the main fixture: `sample.test.ts` holds it to both rules checks with nothing found, to a whole order pack
with nothing blocking, and to goldens of its Gerber, drill, parts list and pick and place files
(`fab/golden/sample.*`). In the model it stands on four standoffs over a printed base, so the sample shows the board
as a step on the timeline too. The `@journey` test in `web/e2e/electronics.spec.ts` opens it, finds the board in the
model, and takes it as far as the preview of the files.

The motor driver, the Qwiic socket and the switch are starter library parts. The sample carries its own copies
(`sample.parts.json`) so that opening it does not load the library, and a test holds the copies to the library's.

What it is not, yet: its order pack has been read back by our own reader and opened in KiCad, and by nothing else.
Nobody has uploaded it to a board house's quote page.

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
- The board's notes go on User.Drawings: lines, text, and dimensions as aligned dimensions KiCad measures again. Coming
  in, drawings on User.Drawings, User.Comments and both fabrication layers become notes, circles and arcs as short
  straight runs, and aligned and orthogonal dimensions become ours.
- Ids are made from the design's own, so the same design always writes the same files.

How it is checked: `export.test.ts` reads the libraries back with our own KiCad readers and holds the sample's
schematic and board to goldens. `kicadCli.test.ts` goes further where KiCad is installed (`kicad-cli`, KiCad 7 or
later; CI has none, so it is skipped there): KiCad reads the exported schematic and writes its netlist, which must
have our nets, pin for pin and name for name; it plots the board's copper, which must lie where ours does on both
sides; and it writes the drill files, which must have our holes. Both the sample and a design made to turn
everything every way (`kicad/fixture.ts`: mirrored and turned symbols, a part with two units, power symbols, wires
that join every way, two sheets, parts on both sides at odd angles) pass against KiCad 7.0.11. So do KiCad's own 11
demo projects (`kicad/demos.test.ts`): each is opened here, written out again, and read by KiCad, which finds the
nets it finds in the demo itself and writes the board's drill file. That showed one fault, now fixed: a part that is
not fitted was written with a word only KiCad 8 knows. Nobody has opened the files in KiCad 8, 9 or 10 yet, or looked
at them on screen: the checks are on nets, copper and holes, not on how the drawing looks.

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
between sheets, pictures, text boxes and shapes on a sheet, net class flags, dimensions other than straight ones
(leaders, radii, centre marks), drawings on user layers, paste and mask drawings in footprints, symbols drawn in their alternate (De Morgan) style, and power
flags. Curved tracks come in as short straight pieces, within 0.5 µm of the curve. A pad whose copper sits off the
middle of its hole keeps it there (#744). Text keeps its place, size, turn and lines, and its letters' own width and
its mirror flag both ways (#751): `mirror` on a board text reads it the other way from its side's usual, and `width`
is a letter's width where it differs from its height (`boardTextLook` in `fab/font.ts`). A board without its
schematic does not open: the nets of a design here come from its schematic. A local label on the top sheet with the
name of a global label is another net in KiCad, so it stays apart here as `/name`, KiCad's own name for it, and the
import says so (#751).

How it is checked: `kicad/project.test.ts` writes the sample and the fixture that turns everything every way out as
KiCad projects and reads them back: the same parts, nets, pads and board check, and nothing for Push to PCB to do.
`kicad/demos.test.ts` runs where KiCad and its demo projects are installed (CI has neither, so it is skipped there):
all 11 demos' schematics come in with exactly the nets `kicad-cli` finds, hierarchy and buses included, and the nine
demo boards come in with no shorts, nothing unrouted and nothing behind the schematic, the two four layer ones
included (the video card's edge connector hangs over its board's edge, as KiCad draws it).

Files from KiCad 8, 9 and 10: set `KICAD_NEWER_DEMOS` to a folder holding `demos/` from each of those branches of
KiCad's source (as `8.0`, `9.0`, `10.0`) and the same test opens every demo each version saved. The KiCad installed
may be too old to open them, so their nets are held to the ones it finds in its own copy of the demo; three copies
that were changed between versions (parts numbered again, a pin moved) are held only to their own boards. All of
them pass. What the newer files needed: a name written with a word in braces ("VPP{slash}MCLR") is the net
"VPP/MCLR"; KiCad 10's board names each net where it is used and keeps no table of them; teardrops, which are zones
in the file, turn the board's teardrop setting on instead of coming in as copper (#743); and a stub of track on a pin that joins nothing is left out and said. A supply
pin that is not drawn joins the net with its name in every version, KiCad 10 included.

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
straight pieces. Hatched pours keep their hatching (#747). Octagon pads come in drawn corner by corner, and a pad Eagle draws
off the middle of its hole ("offset") keeps its copper where Eagle has it (#744). Assembly variants are not
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

- Parts: custom pin shapes (#626), expressions in pad sizes (#627), live stock and prices (#661).
- Eagle and Fusion files (#665): one Fusion schematic opens cleanly. No real board (.brd) has been tried.
- A first real order: the order pack reads back in our own preview, and its copper and holes agree with what KiCad
  plots from the same board, but no board has been ordered with it.
