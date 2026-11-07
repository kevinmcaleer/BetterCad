# Holes for screws

The Hole tool (H) sizes screw holes from a table, so you don't have to look up clearances. Click a flat face, pick a
size, and click where each hole goes. The table lives in `packages/kernel/src/screws.ts`.

## Fits

| Fit | What it's for | M3 |
| --- | --- | --- |
| Clearance for printing | The screw slides through a printed hole. Printed holes come out small, so this is the nominal size plus 0.4 mm. Start here. | 3.4 mm |
| Clearance | A drilled or machined hole the screw slides through (ISO 273 normal). | 3.4 mm |
| Close | A snug fit that still clears the thread (ISO 273 close). | 3.2 mm |
| Tap | The tap drill. Cut a thread with a tap, or let a self-tapping screw cut its own. Threads are not modelled. | 2.5 mm |

If your printer runs tight or loose, print a test plate with a few sizes and use Custom diameter for the one that fits.

## Heads

- **Countersink** cuts a cone so a countersunk (flat) head sits flush: 90° for metric screws, 82° for imperial.
- **Counterbore** cuts a step for a socket cap head: the head's diameter plus 0.4 mm, and its height plus 0.2 mm deep.

## Depth

Type a depth, or choose **Through all** to go right through the body. A blind hole's depth is measured from the face.

## Sizes

Metric: M2, M2.5, M3, M4, M5, M6. Imperial: #4-40, #6-32, 1/4-20. The print-readiness checks (#11) read the same table.
