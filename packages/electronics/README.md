# @bettercad/electronics

The electronics design model (epic #606): components, schematic sheets, the board, and the logic that ties them
together. Framework-free: no React, no three.js, no DOM.

- `model.ts`: the types saved in a `.bcad` file under `electronics`.
- `geom.ts`: 2D helpers. Millimetres, x to the right, y up.
- `nets.ts`: works out the nets from wires, labels, junctions and power symbols.
- `sync.ts`: the change list that keeps the board in step with the schematic.

See `docs/electronics.md`.
