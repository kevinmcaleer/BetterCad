# Speed-modelling torture test

Speed-modelling challenges give you a drawing and ask for the part's mass. The mass checks the whole part at once, so they make a good test of what BetterCad can model and how it models it.

`packages/kernel/src/speedmodel/` models Too Tall Toby's Party Pack 01 (ten parts) as BetterCad timelines. The steps are the ones the app's tools make: sketches, Extrude, Revolve, Fillet, Hole, Mirror, Combine and Library shapes. Each part must build with no failed steps and weigh within 1 g of the challenge's answer. The answers come from [build123d's worked versions](https://build123d.readthedocs.io/en/stable/tttt.html), which run on the same OpenCascade kernel. Toby's drawings may be used for any educational purpose.

```sh
npx vitest run packages/kernel/src/speedmodel        # SPEED_LOG=1 prints each mass
```

## Results (2026-11-10)

| Part                  | Result                                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| 01-01 Bearing Bracket | 797.15 g, matches                                                      |
| 01-02 Post Cap        | Can't model it: needs an ellipse (#401) and Sweep (#400)               |
| 01-03 C Clamp Base    | 96.13 g, matches                                                       |
| 01-04 Angle Bracket   | 310.00 g, matches                                                      |
| 01-05 Paste Sleeve    | Can't model it: needs Loft (#399)                                      |
| 01-06 Bearing Jig     | 328.02 g, matches                                                      |
| 01-07 Flanged Hub     | Can't model it: needs a taper angle on Extrude (#402)                   |
| 01-08 Tie Plate       | 3387.06 g, matches                                                     |
| 01-09 Corner Tie      | 307.23 g, matches                                                      |
| 01-10 Light Cap       | 211.30 g, matches (2.3 s to build, most of it the R8 round on the rim) |

Workarounds the parts needed, each a gap a person would hit in the app. The gaps are tracked in #398.

- No Slot tool: five parts draw slots as two lines and two arcs.
- The Hole tool only sizes heads from the screw table, and the table stops at M6. The bearing's Ø24 hole with a Ø34 counterbore and the Corner Tie's Ø8 with Ø15 are two Extrude cuts each.
- The Arc tool is three-point only. Tangent arcs and arcs by centre were worked out by hand.
- No Split body: half-shapes were drawn as half-shapes instead of cut in two.

## Adding a part

Write a function in `parts.ts` that builds the part with `Timeline` from `kit.ts`, and add it to `PARTS` with the challenge's mass and density. Pick edges for fillets with `t.edges(body, test)`, by where they run, as you would click them. A part the app can't model yet goes in with `missing` instead of `build`: it shows as a to-do in the test run.
