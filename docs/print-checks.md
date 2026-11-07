# Print checks

The Print panel (the printer icon in the rail) gets a model ready for the printer (epic #11).

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

## Still to come

- Wall thickness (#101), overhangs (#102) and orientation suggestions (#103).
- Printed-fit hole sizes tied to the printer (#104).
- Saving custom printers and a price per kilogram to your account.
