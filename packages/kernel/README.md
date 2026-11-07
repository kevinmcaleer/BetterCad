# @bettercad/kernel

The modelling kernel: OpenCascade in a Web Worker, the model document, and the meshes the viewport draws.

| Entry | What it is | Who imports it |
| --- | --- | --- |
| `@bettercad/kernel` | Mesh types, JS primitives, errors, `KernelClient`, protocol types | The app |
| `@bettercad/kernel/document` | The model document (`ModelDoc`, features, `build(doc, upTo)`) | The app, the worker |
| `@bettercad/kernel/browser` | `kernel()`: the one worker per tab | The app |
| `@bettercad/kernel/occt` | OCCT operations (shapes, booleans, fillet, shell, measure, tessellate) | The worker and Node tests only |

The app never calls OCCT directly. It sends `build` calls to the worker (`src/worker.ts`) through `KernelClient`, which
handles ids, cancellation, load progress and restarting the worker after a crash.

## Tests

- `npm test` runs everything, including the OCCT tests in Node (the WASM loads in about 200 ms).
- `npm run test:golden` runs the golden geometry tests alone. Each operation's exact volume, area, box and topology
  counts are stored in `golden/`. To accept a deliberate change, run `UPDATE_GOLDEN=1 npm run test:golden` and commit.

## WASM

See [VERSIONS.md](VERSIONS.md). The WASM is shipped unmodified as its own file, so you can swap in your own build.
