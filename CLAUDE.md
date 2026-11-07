# BetterCad

A free, browser-based CAD tool for 3D printing: Fusion-style constrained sketches, Tinkercad-style push, pull and combine.

## Commands

- `make install` — npm install and uv sync
- `make dev` — FastAPI on :8000 and Vite on :5173 (Vite proxies `/api`)
- `make test` — Vitest across the workspaces, then pytest with coverage
- `npm run test:golden` — kernel, sketch and timeline goldens (`UPDATE_GOLDEN=1` to accept a deliberate change); `npm run test:nightly` adds every sample and `fixtures/` model with STL and STEP round trips
- `make lint` — ESLint, Prettier check, ruff
- `make typecheck` — `tsc` (strict) over every TypeScript package
- `make build` — regenerates tokens, builds `web/dist`
- `npm run e2e` — builds, serves and runs Playwright (Chromium), including axe in all three themes. No retries: tag a flaky test `@quarantine`; `@journey` tests also run nightly in WebKit
- `npm run e2e:visual` — screenshot tests (@visual). CI writes missing baselines; run the Update screenshots workflow to accept a deliberate change
- `npm run tokens` — regenerate `packages/ui/src/tokens.css` and `tokens.ts` from `tokens.json`

## Layout

- `web/` — the React app. `src/editor` is the shell, `src/state` is framework-free logic (history store, document, command registry, theme), `src/gallery` is `#/gallery` (dev and preview builds only, `VITE_GALLERY=1`).
- `packages/ui` — design-system tokens, `src/styles/*.css` (`bc-` classes, one sheet per component), the Esc stack (`escape.ts`), the expression parser (`expr.ts`), icons and React components.
- `packages/kernel` — OpenCascade worker API (epic #4). WASM in `wasm/`.
- `packages/sketch` — planegcs solver wrapper (epic #5). WASM in `wasm/`.
- `server/` — FastAPI app factory (`bettercad/main.py`), settings, SQLite with `.sql` migrations.

## Rules

- The 3D view fills the whole window. The top bar, rail, panels, tool bars, timeline and overlays float over it as cards and never box it in: no docked columns, no frame around the view. Overlays inside the view keep clear of the cards with the `--bc-view-top/left/right/bottom` insets set on `.bc-app`.
- Tokens only. Components use `var(--bc-…)`; no literal colours outside the generated `tokens.css`. A test enforces it.
- Never edit `tokens.css` or `tokens.ts` by hand. Change the design system, copy `tokens.json`, run `npm run tokens`.
- Every action is a command in `web/src/state/commands.ts` style: label, keys, run. Shortcuts show in tooltips as "Label (K)".
- Esc always backs out one layer: register it with `useEscape(active, fn, ESC.<level>)`, never a raw keydown listener. Single-letter shortcuts never fire while typing in a field.
- The kernel never touches the DOM; the app never calls OCCT directly, only through `@bettercad/kernel`.
- Z up, millimetres everywhere.
- Every modelling action becomes a timeline feature (epic #7). Every kernel operation needs a golden test.
- UI text follows the brand book: short, second person, sentence case, units shown ("5 mm", "15°"), no exclamation marks, no emoji.
- Text pairs hold 4.5:1 in Light, Dark and Holodeck (`packages/ui/src/tokens.test.ts`). Fix failing pairs in the design system.
- Test by role and label with Testing Library, not DOM snapshots.

## Decisions (ask Kev before changing)

- Stack: React 18 + TypeScript + Vite in `web/`; Python 3.13 + FastAPI + SQLite (WAL) in `server/`; one multi-arch Docker image.
- Kernel: OpenCascade via opencascade.js, WASM, in a Web Worker.
- Sketch solver: planegcs. Renderer: three.js.
- Local-first: the editor works offline and without an account; the server stores only accounts and saved models.
- Units: millimetres only in v1.
- Licence: MIT for our code; OCCT and planegcs LGPL, loaded unmodified.

## Links

- Design system: https://claude.ai/artifact/MfEzeMVbydgaztQzHAHKTN
- Epics: https://github.com/kevinmcaleer/BetterCad/issues?q=label%3Aepic
