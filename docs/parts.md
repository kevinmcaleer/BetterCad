# Robot parts and reference bodies

Epic #167: drop in the servos, motors, boards and sensors a robot uses, design mounts round them, and cut their pockets in one click.

## Reference bodies (#185)

A reference body is there to design around: a servo you're making a bracket for, or an STL of a part you already own. It shows in the view, see-through and tinted in the accent colour, but it never prints.

- Turn it on with **Reference** in Properties, **Make a reference** on the right-click menu, or the **Reference or printed** command.
- **File > Import as a reference…** brings in an STL, STEP or 3MF file as reference bodies straight away.
- Reference bodies are left out of STL, 3MF and STEP export, the bed fit check, overhang and thin-wall checks, orientation suggestions, the print weight and the fits check. Choosing only reference bodies in Export says so.
- Measure, snapping and sketch projection still work on them, so you can size a mount from the real part.
- `printed()` in `packages/kernel/src/document.ts` is the one test for "does this body print": not hidden, not a hole, not a reference.

Later, a robot's links (#164) will count a reference body's datasheet mass, and the clash check (#165) can include it.

## The catalogue (#186)

`packages/kernel/src/catalogue/` holds the parts, one record each, checked against `part.schema.json` and `checkPart()`:

- **Model**: boxes and cylinders, close enough to design round and see clashes. `catalogueShape()` in `occt/catalogue.ts` joins them into one solid (goldens `catalogue-sg90` and `catalogue-608`).
- **Origin**: z = 0 is the surface the part sits on or screws to, x and y centred on its footprint. Anything below z = 0 goes into the pocket.
- **Cutout**: the pocket outlines and depth at the part's nominal size (the fit's gap is added when it's cut, #183), and screw holes by the screw table's size.
- **Mount**: the output shaft or centre, for joints (#164). **Mass** in grams.
- **Checked**: true only when the outline and holes come from the maker's drawing or a standard (the Picos, Pis, bearings and 18650). The servos, motors and HC-SR04 come from common listings: measure yours before printing anything tight.
- **Version** goes up when a model or cutout changes. Records are MIT.

The first parts: SG90, MG90S and MG996R servos; N20 and TT gear motors; Raspberry Pi Pico, Pico W, Zero 2 W, 4 and 5; HC-SR04; 608 and 623 bearings; an 18650 cell.

To add a part, add a record to `parts.ts`. The tests check it validates, builds a valid solid the size of its blocks, keeps everything below the surface inside its pocket, and puts its holes on the part.
