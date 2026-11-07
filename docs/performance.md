# Load-time budget

BetterCad has to open fast on a Raspberry Pi 5 and a phone (#97). These are the budgets and how we check them.

| Milestone | Pi 5, fresh visit over 50 Mbit | Pi 5, cached | Laptop, fresh | Laptop, cached |
| --- | --- | --- | --- | --- |
| Shell interactive (the empty grid orbits) | 2 s | 1 s | | |
| Kernel ready (the worker reports `ready`) | 6 s | 1 s | 2 s | 0.3 s |

## How the app meets it

- **First paint carries only the shell**: React, the UI, the viewport and three.js. CI fails the build when that JavaScript passes 350 KB gzipped (`npm run size -w web`, which also writes a table to the job summary).
- **The kernel arrives after first paint.** `useKernel` imports the client lazily. The worker then fetches the 23 MB OpenCascade WASM, reporting progress as it downloads, and the service worker keeps it for later visits. Calls made while it loads wait in the worker's queue, so an export or a build pressed early runs once it's ready.
- **The sketch solver loads on first sketch.** planegcs is its own chunk and WASM.
- **The account and library pages are their own chunk** (`pages/lazy.ts`).
- **No dev-only code ships.** The size check fails if a release build contains a gallery or test hook, or React's development build.
- **Brotli.** The build writes a `.br` and a `.gz` beside each asset over 10 KB, and the server sends the smallest one the browser accepts. The kernel WASM is 7.2 MB gzipped and 5.7 MB with Brotli. Caddy and nginx pass the encoded file through. Check it with:

  ```sh
  curl -sI -H 'Accept-Encoding: br' https://bettercad.kevsrobots.com/assets/<the replicad .wasm> | grep -i content-encoding
  ```

- **The service worker** (#94) serves everything from cache after the first visit, which is where the "cached" budgets come from.

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
