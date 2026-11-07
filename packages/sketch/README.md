# @bettercad/sketch

Sketching (epic #5), framework-free so it runs in Node for tests:

- `model.ts`: the sketch (points, lines, arcs, circles; constraints; dimensions; the plane and its frame).
- `geom2d.ts`: 2D maths for the tools (arcs from three points, polygons, intersections, fillet corners).
- `draw.ts`: what each drawing tool adds, as pure functions, with the automatic constraints.
- `profiles.ts`: closed loops and holes, for extrude.
- `solver.ts`: planegcs (FreeCAD's solver, WASM) behind `Solver.load()`, `solve()` and `drag()`.
- `dof.ts`: which entities are fully constrained, for the state colours.

## Tests

`npm test` runs everything with the real planegcs WASM. `npm run test:golden` includes the golden sketches in
`golden/` (an L bracket, a plate with four holes, a slot, a hexagon); `UPDATE_GOLDEN=1` accepts a change.

## WASM

`@salusoft89/planegcs` 1.3.0 (LGPL 2.0 or later), shipped unmodified: `planegcs.wasm` is 480 kB. In the browser pass
its URL to `Solver.load(url)`; in Node it is found beside the glue.
