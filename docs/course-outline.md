# Learn BetterCad: course outline (draft)

> **Draft for Kev to agree (#110).** Twelve lessons of 5 to 10 minutes each. Once the outline is agreed, the lessons
> are written in the kevsrobots course builder's format and added to `kevinmcaleer/kevsrobots.com` in a separate PR.
> Help → Learn BetterCad links to `https://www.kevsrobots.com/learn/bettercad/` (`web/src/help/about.ts`); change it
> there if the course lives somewhere else.

Lessons 2 to 4 quote the first-run tour (`web/src/tour/tour.ts`) word for word, so the tour and the course teach the
same thing. If the tour copy changes, change these lessons too.

Screenshots come from `npm run docs:shots`, which saves every sample in Light, Dark and Holoroom to `docs/images/`. Run
it again whenever the interface changes.

Each lesson ends with a short exercise and a `.bcad` file you can compare your model against.

| # | Lesson | Minutes | What you learn | Exercise and answer file |
| --- | --- | --- | --- | --- |
| 1 | Introduction | 5 | What BetterCad is for, how it runs in the browser and works offline, and a tour of the screen: the toolbar, the parts tree, the timeline and properties. | Open the bracket sample and find its parts. `bracket.bcad` |
| 2 | Look around and sketch | 6 | Tour steps 1 and 2: "Drag to look around, right-drag to pan, scroll to zoom." "Press Sketch (K) and click the ground. Draw a rectangle with R, then press Enter to finish the sketch." | Sketch a 40 × 20 mm rectangle. New: `lesson-02.bcad` |
| 3 | Extrude and fillet | 7 | Tour steps 3 and 4: "Press Extrude (E), click inside the rectangle, type 10 and press Enter." "Press Fillet (G), click the top edges, type a radius like 2 mm and press Enter." | Make a 10 mm block with 2 mm rounded top edges. New: `lesson-03.bcad` |
| 4 | Export your first print | 5 | Tour step 5: "Press Ctrl+E, or Export in the Save menu, and save the STL." STL, 3MF and STEP, and when to use each. | Export the block as 3MF. Same file as lesson 3 |
| 5 | Sketching with constraints | 10 | Lines, arcs and circles; horizontal, vertical, coincident and tangent constraints; reading a fully constrained sketch. | Constrain a slot shape fully. New: `lesson-05.bcad` |
| 6 | Dimensions | 8 | Dimensions, typing expressions like `20 / 2`, and changing a dimension later to resize the part. | Make a plate whose holes stay centred when it is resized. New: `lesson-06.bcad` |
| 7 | Push, pull and shapes | 8 | Push and pull faces, the shapes library (box, cylinder, wedge…), and moving and rotating parts. | Build a simple enclosure from shapes. New: `lesson-07.bcad` |
| 8 | Combining parts and holes | 10 | Join, cut and intersect; the Hole tool, screw sizes and fits; the printer's hole offset and the calibration coupon. | Add M3 clearance holes to the enclosure. `hole-calibration.bcad` |
| 9 | Fillets, chamfers and shells | 8 | Rounding and bevelling edges, and hollowing a part with a wall thickness. | Shell the enclosure to 2 mm walls. `box-with-lid.bcad` |
| 10 | The timeline and parameters | 9 | Editing earlier steps, rolling back, naming parameters and driving the model from them. | Make the enclosure's width a parameter. New: `lesson-10.bcad` |
| 11 | Saving, sharing and printing tips | 8 | Saving files and saving to your account, share links, and the print checks: overhangs, thin walls, and orientation suggestions. | Find and fix an overhang in the bracket. `bracket.bcad` |
| 12 | Project: a phone stand | 10 | Building the phone stand sample from scratch using everything above. | Build the stand, then compare. `phone-stand.bcad` |

## Questions for Kev

- Is twelve lessons the right length, or should lessons 5 and 6 merge into one?
- Should the course embed the launch video (#111) in lesson 1 once the video exists?
- The new `lesson-NN.bcad` answer files go in `web/public/samples/`. Should they also appear in the in-app Library?
