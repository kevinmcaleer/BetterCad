# Fits between printed parts

When one printed part goes into another, a peg in a pocket or a lid on a box, the space between them decides whether they press together, slide or rattle. Printers put down plastic a little wider than the model, so a pocket drawn exactly the size of its peg prints too tight. A fit leaves a gap (epic #166).

## Named fits (#181)

| Fit | Gap each side | What it's for |
| --- | --- | --- |
| Press fit | 0.15 mm | The parts push together by hand and stay put. Good for pins, bearings and magnets. |
| Sliding fit | 0.25 mm | The parts slide together without forcing and without wobble. Start here for lids, slots and shafts that turn. |
| Loose fit | 0.4 mm | The parts drop together with room to spare. Good for hinges, quick-release parts and big prints that warp. |

These are typical FDM starting points and vary by printer and material. The table and the notes live in `packages/kernel/src/print/fits.ts`. A model's print settings can tune each gap (`PrintSettings.fits`); printer profiles (#180) and the calibration print (#182) will set them.

**Each side, not the diameter.** A fit's gap is added on every side, so a 10 mm peg with a sliding fit leaves a 10.5 mm pocket. The hole offset used by the Hole tool (#104, [holes.md](holes.md)) is different: it's added to a hole's diameter, so a 0.4 mm hole offset is a 0.2 mm gap each side.

## Cut with a fit (#183)

- **Combine**: pick Cut and the Fit menu appears beside it. Choose No gap, a named fit, or Custom gap. The bodies being cut away are grown by the gap first, so the original stays the size you drew it.
- **Group with holes**: select a hole body and pick its Fit in Properties. When it is grouped, it cuts with that gap.

The kernel grows the tool with `BRepOffsetAPI_MakeOffsetShape` (`grow` in `packages/kernel/src/occt/shapes.ts`). Flat faces move out and meet at sharp corners, so a box grows into a slightly bigger box and a cylinder into a wider cylinder.

The step keeps the gap it was made with, so changing printer never quietly resizes a cut. Printer profiles (#180) will offer to update fitted cuts, as the Print panel does for holes.
