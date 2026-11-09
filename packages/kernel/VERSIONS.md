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

`packages/kernel/occt/config.mjs` writes the build config from the classes the kernel uses: every `oc.X` and every
type imported from `replicad-opencascadejs`, plus the classes their methods take and return (two steps out by
default). The **OpenCascade build** workflow (Actions tab, run by hand) links it with the same opencascade.js 3.1.0
toolchain replicad uses (pinned by digest), prints its size against the 12 MB / 3.5 MB Brotli targets, runs the
kernel's tests and goldens on it, and keeps the result as an artifact. Locally: `npm run build:occt` (needs Docker).

Nothing ships from it yet: when a run passes and is smaller, its files replace `replicad_single.*` in a pull request
that records the sizes here.
