# Print checks

The Print panel (the printer icon on the top bar) gets a model ready for the printer (epic #11).

## The bed (#100)

Pick your printer and the view shows its bed. The bed is drawn as:

- a plate at Z = 0 with its outline;
- the build volume as a faint box;
- a small cross where the slicer puts 0, 0.

Bambu and Prusa slicers put 0, 0 in the middle of the bed. Ender and Elegoo put it at the front-left corner. The grid stays under the bed for snapping. Show the bed turns it off for this browser.

The presets are in `packages/kernel/src/print/printers.ts`:

| Printer | Build volume (mm) | Origin |
| --- | --- | --- |
| Bambu A1 Mini | 180 × 180 × 180 | centre |
| Bambu A1, P1 or X1 | 256 × 256 × 256 | centre |
| Prusa MK4 | 250 × 210 × 220 | centre |
| Prusa Mini | 180 × 180 × 180 | centre |
| Ender 3 | 220 × 220 × 250 | corner |
| Elegoo Neptune 4 | 225 × 225 × 265 | corner |

Custom takes any X, Y and Z. The choice is saved in the model, so anyone you share it with sees the same bed.

The fit check compares the size of the bodies that print with the build volume. Hidden bodies and holes don't count. If the model is too big, the panel and the Export dialog both say by how much, for example "The model is 12 mm too wide for a Bambu A1 Mini". With the bed shown, bodies outside it are tinted.

Centre on bed moves the model to the middle of the bed with its lowest point on it. This is one step on the timeline, so you can undo it.

## Weight (#105)

When something is selected, the Properties panel shows its:

- volume (cm³);
- surface (cm²);
- size;
- estimated weight in the model's material, at its infill.

With nothing selected, it shows the whole model's volume and weight. Pick the material and infill in the Print panel.

| Material | Density (g/cm³) |
| --- | --- |
| PLA | 1.24 |
| PETG | 1.27 |
| ABS | 1.04 |
| TPU | 1.21 |
| ASA | 1.07 |

The estimate treats the part like a slicer does:

- **Shell**: a solid shell over the whole surface, about 3 walls of 0.42 mm plus 1 mm of top and bottom. The shell is capped at the part's volume, so a thin part counts as solid.
- **Inside**: the rest of the part, filled at the infill percentage.

So, weight = density × (shell + (volume − shell) × infill).

This is usually within about 20% of a slicer, so the panel says "about 18 g". Meshes imported with gaps in their surface have no true volume, so they show "–".

## Overhangs and thin walls (#101, #102)

The Checks row in the Print panel shows one check at a time. It tints the problem areas on the bodies that print, lists them, and has a Show button that frames each one.

**Overhangs.** A downward face steeper than the limit needs support. The limit defaults to 45° and can be set from 30° to 70°. A face counts if the steepness of its downward normal, measured from vertical, is past the limit and its lowest corner is more than 0.2 mm above the bed. The tint gets stronger as the face nears flat. This uses the display mesh, so it's instant. It doesn't recognise bridges yet: a short flat span a printer can cross is still flagged.

**Thin walls.** The check casts a ray from the middle of each triangle straight into the body. Where the ray reaches the far wall sooner than the limit, the wall is thin. The limit defaults to two nozzle widths, 0.8 mm for a 0.4 mm nozzle. Areas that touch, or are within 1.5 × the limit of each other, are listed as one, with their thinnest point.

It runs in the geometry worker, so the editor stays responsive. Rays only test the surface they start from, so a wall met at a grazing angle can be missed. Treat it as a guide, not a proof.

## Still to come

- Orientation suggestions (#103).
- Printed-fit hole sizes tied to the printer (#104).
- A price per kilogram. (Saving your printers is done: see [fits.md](fits.md#your-printers-180).)

## Orientation suggestions (#103)

The Print panel's Orientation group shows three ways to lay the model down, each with a thumbnail of the model turned that way. The kernel worker works them out once per build while the panel is open (`orient` in `packages/kernel/src/print/orient.ts`).

- **Candidates**: flat kernel faces with more than 5% of the surface, plus the faces of the convex hull (quickhull over the mesh's points, with hull triangles within about 1° binned together), so a curved or open model can rest on the plane across its feet. Straight down as it lies now is always a candidate.
- **Score**: contact area 0.4, overhang area 0.4 (lower is better, at the overhang check's angle), height 0.2 (lower is better). Each is divided by the largest among the candidates. You can change the weights in Settings, under Advanced; they're kept per browser.
- **Applying one**: one Move per part, turned about the origin and then moved to the middle of the bed at Z = 0. It's one undo step. The way it lies now is marked in `accent-soft`.
- **Speed**: about 0.4 s for a 40k-triangle sphere in the dev container, where every point is on the hull (the worst case for the hull). Flat-faced models are much faster.

They're suggestions, never "best". A part that needs a particular face up for looks or strength may want another one.
