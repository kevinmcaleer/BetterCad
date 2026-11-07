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

## Placing a part (#187)

- Open **Catalogue** on the rail. Parts are listed by category; search matches every word you type against the name and description.
- Pick a part, then click a flat face, or the ground. The part stands with its z along the face's normal, its origin where you clicked (on a 0.5 mm grid). Press **T** (or **Turn 90°**) to turn it a quarter first; Esc puts it back.
- It comes in as a reference body, named after the part, with an **Insert part** step on the timeline. The step keeps a copy of the part's record, so a later catalogue change never moves an old model. Properties shows the part and its mass.
- The catalogue is part of the app's code, so the service worker caches it with everything else and it works offline.

## Cut pocket (#188)

Select a placed catalogue part and choose **Cut pocket** (right-click, or the command palette). BetterCad finds the body just under the part and adds ordinary steps you can edit:

- a sketch of the pocket on the part's surface, named after the part,
- an extrude cut into that body, the part's pocket depth, at a sliding fit (#183),
- a Hole step for each screw size, printed clearance, right through. `cutPocket()` can make heat-set insert holes instead, as deep as the insert plus 1 mm.

Parts with no pocket (the boards) get only their holes. The steps follow the part's turn. If you move the part later, its pocket stays where it was: edit or delete the steps.

## Mounting features (#189)

The **Mount** tool makes one editable step on a flat face:

- **Standoffs**: click to add posts, or pick a **Pattern**. You can choose one standoff, a 40 × 30 mm rectangle, a circle of four, or any catalogue part's holes (Pi 58 × 49 mm, Pico 47 × 11.4 mm, Zero 58 × 23 mm, servos…). Picking a part's pattern also picks its screw. Set the height and width, and choose **Through** for a printed clearance hole right through, or **Insert** for a heat-set insert hole at the top.
- **Horn mount**: bolts a servo horn to a printed part, with no printed splines. It makes a recess for the hub, a screwdriver hole down to the servo's screw, and screw holes on the arms of a single, double or cross horn. The defaults suit a micro servo's horn, but measure yours.

`mountOps()` in document.ts turns the step into a join and holes. `HOLE_PATTERNS`, `rectPattern()` and `circlePattern()` in the catalogue give the patterns. Goldens: `standoffs-pi-through`, `standoffs-pi-insert`, `horn-cross`.
