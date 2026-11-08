# Load-time budget

BetterCad has to open fast on a Raspberry Pi 5 and a phone (#97). These are the budgets and how we check them.

| Milestone | Pi 5, fresh visit over 50 Mbit | Pi 5, cached | Laptop, fresh | Laptop, cached |
| --- | --- | --- | --- | --- |
| Shell interactive (the empty grid orbits) | 2 s | 1 s | | |
| Kernel ready (the worker reports `ready`) | 6 s | 1 s | 2 s | 0.3 s |

## How the app meets it

- **First paint carries only the shell**: React, the UI, the viewport and three.js. CI fails the build when that JavaScript passes the shell budget in `budgets.json` (362 KB gzipped) (`npm run size -w web`, which also writes a table to the job summary).
- **The kernel arrives after first paint.** `useKernel` imports the client lazily. The worker then fetches the 23 MB OpenCascade WASM, reporting progress as it downloads, and the service worker keeps it for later visits. Calls made while it loads wait in the worker's queue, so an export or a build pressed early runs once it's ready.
- **The sketch solver loads on first sketch.** planegcs is its own chunk and WASM.
- **The account and library pages are their own chunk** (`pages/lazy.ts`).
- **No dev-only code ships.** The size check fails if a release build contains a gallery or test hook, or React's development build.
- **Brotli.** The build writes a `.br` and a `.gz` beside each asset over 10 KB, and the server sends the smallest one the browser accepts. The kernel WASM is 7.2 MB gzipped and 5.7 MB with Brotli. Caddy and nginx pass the encoded file through. Check it with:

  ```sh
  curl -sI -H 'Accept-Encoding: br' https://bettercad.kevsrobots.com/assets/<the replicad .wasm> | grep -i content-encoding
  ```

- **The service worker** (#94) serves everything from cache after the first visit, which is where the "cached" budgets come from.

## Budgets in CI (#108)

[`budgets.json`](../budgets.json) holds every budget, and CI's `budgets` job checks them on each pull request. It posts one comment with the table and updates it on later runs.

- **Bundle**, KB gzipped: the shell (first paint) 362, the pages chunk 120, the kernel client 30, all JavaScript 630.
- **WASM**: OpenCascade under 24 MB (5.4 MB of it with Brotli), planegcs under 1 MB. The target is 12 MB, or 3.5 MB with Brotli. That needs a slimmer build of the same unmodified OCCT (#50), so the budget holds today's size until then.
- **Kernel benchmarks** (`npm run bench:kernel`): building samples, a fillet, a fine mesh, the print checks. Each is the median of three runs and may be up to 20% over its baseline.
- **Viewport** (`npm run bench:viewport`, against a gallery build being served): one frame of the calibration coupon in Chromium with SwiftShader, up to 25% over its baseline.
- **Lighthouse** on the release build, desktop preset: performance at least 0.6, with 0.85 as the target. It must also be installable.

Baselines are a CI runner's numbers, which run 2 to 3 times slower than a laptop. To change one, edit `budgets.json` in a pull request and say why. Nothing updates them automatically.

Under SwiftShader, Lighthouse scores about 0.7. Nearly all of the cost is total blocking time: software WebGL compiles the view's shaders on the main thread for about 1 s, and with WebGL turned off the score is 100. Compiling shaders in parallel (`KHR_parallel_shader_compile`, three.js `compileAsync`) is the likely fix, and it should also help a Pi 5.

The real-device numbers below stay manual.

## Measuring

The app marks two milestones with `performance.mark`, each measured from the start of navigation:

- `bc:shell`, when the 3D view can first be orbited;
- `bc:kernel`, when the geometry engine reports ready.

They show in the dev overlay beside the frame time (`npm run dev`, then Show frame times from the command palette). In any build you can read them in DevTools' Performance panel, or in the console:

```js
performance.getEntriesByType("mark").filter((m) => m.name.startsWith("bc:")).map((m) => [m.name, Math.round(m.startTime)])
```

For a fresh visit, clear site data first (DevTools > Application > Clear site data). For a cached visit, reload.

## Results

Add a row each time you measure on a real device, with the date and the commit.

| Date | Device | Browser | Network | Shell fresh | Shell cached | Kernel fresh | Kernel cached |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-07 | Cloud container (4 cores), headless | Chromium | localhost, no throttling | 0.2 s | 0.1 s | 0.7 s | 0.5 s |
| | Raspberry Pi 5 | Chromium | 50 Mbit | | | | |
| | Laptop | | | | | | |
| | Mid-range Android phone | Chrome | | | | | |

The first row is a baseline from CI-like hardware with no network cost. The Pi 5, laptop and phone rows still need measuring on the devices.

## Still to do

- Compile the WASM with `WebAssembly.compileStreaming` and keep the compiled module (#50). Today the worker downloads the bytes to report progress and compiles them after, so a cached visit still pays the compile, which is most of the Pi 5's kernel time.
