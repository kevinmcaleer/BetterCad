# Kernel versions

| Piece | Version | Licence | Notes |
| --- | --- | --- | --- |
| replicad-opencascadejs | 1.2.1 | LGPL 2.1 with the OCCT exception | A trimmed opencascade.js build (OCCT 7.6) made for replicad. Single-threaded, with exceptions. |
| WASM file | `replicad_single.wasm`, 23 MB (7.2 MB gzipped) | | Served as a separate, unmodified asset. The build writes a `.gz` beside it. |

## Why this build

The full opencascade.js build is about 60 MB. replicad's build carries what a CAD tool for 3D printing needs
(primitives, booleans, fillets, chamfers, offsets, sweeps, STEP and STL) at about a third of the size, and it is
published on npm with typings, so it installs with `npm ci` and needs no Docker.

## Swapping the WASM

Replace the package (or point `loadOCCT({ wasmUrl })` at your own file). The glue and the WASM must come from the same
build. Run `npm run test:golden` afterwards: a different OCCT can move numbers slightly, and the golden files say where.

## A custom build (#43)

`occt.build.yml` lists the classes BetterCad uses. A custom opencascade.js build from that list should come in well
under 23 MB. It needs Docker and about an hour of CPU, so it is not part of CI yet.
