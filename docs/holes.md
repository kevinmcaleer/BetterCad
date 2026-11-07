# Holes for screws

The Hole tool (H) sizes screw holes from a table, so you don't have to look up clearances. Click a flat face, pick a
size, and click where each hole goes. The table lives in `packages/kernel/src/screws.ts`.

## Fits

| Fit | What it's for | M3 |
| --- | --- | --- |
| Clearance for printing | The screw slides through a printed hole. Printed holes come out small, so this is the nominal size plus your printer's hole offset (0.4 mm unless you change it). Start here. | 3.4 mm |
| Heat-set insert | A hole to melt a brass insert into. M2 3.2, M2.5 3.5, M3 4.0, M4 5.6, M5 6.4 mm, made as deep as the insert plus 1 mm. M6 and the imperial sizes have none in the table. | 4.0 mm |
| Clearance | A drilled or machined hole the screw slides through (ISO 273 normal). | 3.4 mm |
| Close | A snug fit that still clears the thread (ISO 273 close). | 3.2 mm |
| Tap | The tap drill. Cut a thread with a tap, or let a self-tapping screw cut its own. Threads are not modelled. | 2.5 mm |

The Fit menu shows each fit with the diameter it comes to, such as "Clearance for printing (3.4 mm)", and the bar explains the one you picked. The explanations live beside the data in `packages/kernel/src/screws.ts` (`fitNote`), so the Learn course can quote them.

## Tuning the hole offset (#104)

Every printer prints holes a little differently. The Print panel's **Hole offset** sets what a printed clearance adds, from 0 to 1 mm. It's kept with the model.

To find yours, click **Calibrate holes** in the Print panel. That opens the hole calibration coupon (`web/public/samples/hole-calibration.bcad`): a 3 mm plate with M2 to M6 holes, one row each from the front, at offsets of 0.2 to 0.6 mm, one column each from the left. The notches on the front edge count the column: one notch is 0.2 mm and five is 0.6 mm. Print it flat, try a screw in each row, and set the offset to the first column it slides through.

Each Hole step keeps the offset it was made with, so changing the offset never quietly resizes holes you've already placed. When some printed holes were made at another offset, the Print panel offers **Update N holes**. That edits those steps on the timeline, as one undo step.

Insert holes don't use the offset: insert makers give the printed hole size directly.

Fits between two printed parts, such as a peg in a pocket, are a gap on each side rather than an offset on the diameter: see [fits.md](fits.md).

## Heads

- **Countersink** cuts a cone so a countersunk (flat) head sits flush: 90° for metric screws, 82° for imperial.
- **Counterbore** cuts a step for a socket cap head: the head's diameter plus 0.4 mm, and its height plus 0.2 mm deep.

## Depth

Type a depth, or choose **Through all** to go right through the body. A blind hole's depth is measured from the face.

## Sizes

Metric: M2, M2.5, M3, M4, M5, M6. Imperial: #4-40, #6-32, 1/4-20. The print-readiness checks (#11) read the same table.
