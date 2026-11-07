# Contributing to BetterCad

Thanks for helping. This page covers setting up, running the tests, and the rules a change has to follow. Questions
are welcome on the kevsrobots Discord; bugs and ideas go in [GitHub issues](https://github.com/kevinmcaleer/BetterCad/issues/new/choose).

## Set up

You need Node (the version in `.nvmrc`), Python 3.13 and [uv](https://docs.astral.sh/uv/).

```sh
make install   # npm install and uv sync
make dev       # FastAPI on :8000 and Vite on :5173
```

Open http://localhost:5173. The editor works without the server; accounts and cloud saves need it.

## Tests

| Command | What it runs |
| --- | --- |
| `make test` | Vitest across the workspaces, then pytest |
| `npm run test:golden` | The geometry goldens: kernel operations, sketches, the timeline |
| `npm run test:nightly` | The full model set (samples, `fixtures/`, format files) with STL and STEP round trips, plus the goldens |
| `npm run e2e` | Playwright in Chromium, including axe in all three themes |
| `npm run e2e:visual` | Screenshot tests |
| `make lint`, `make typecheck` | ESLint, Prettier, ruff; strict `tsc` |

End-to-end specs use the page objects in `web/e2e/pages/`, so a spec reads like the person's steps. Tests tagged
`@journey` (the box-with-hole flow, the tour, opening a sample, saving, cloud saves, sharing) also run nightly in WebKit.
CI never retries a test: a flaky one is fixed, or tagged `@quarantine` with an issue linked in a comment. Quarantined
tests run in their own job that can't block a merge. They are never deleted quietly.

CI runs everything except the nightly set on every pull request. The nightly runs at 03:00 UTC, and when it fails it
opens one issue labelled `nightly-failure`.

## Goldens

Every kernel operation has a golden test (#49): it builds a shape and compares its exact measurements (volume, area,
centroid, bounding box, faces, edges) with a stored answer in `packages/kernel/golden/`. Sketch goldens live in
`packages/sketch/golden/`.

When a number moves, the CI job summary shows a table of each measure, its golden value and what it is now. If the
change is a bug, fix it. If it is deliberate (a better fillet, an OCCT upgrade):

1. Run `UPDATE_GOLDEN=1 npm run test:golden` to rewrite the stored answers.
2. Review the diff of `packages/*/golden/` line by line. Only the numbers you expected should move.
3. Explain in the pull request why they changed. For example: "Fillets now use the rolling-ball setting, so the
   rounded box loses 0.3 mm³".

Fixtures work the same way, with `NIGHTLY=1 UPDATE_GOLDEN=1 npm run test:nightly`. See `fixtures/README.md`.

## Rules for a change

- Every modelling action is a timeline feature, and every kernel operation needs a golden test.
- Every action is a command (label, keys, run). Esc goes through `useEscape`, never a raw key listener.
- Colours come from design tokens only. Never edit `tokens.css` or `tokens.ts` by hand.
- Test by role and label with Testing Library, not DOM snapshots.
- UI text follows the brand book: short, second person, sentence case, units with a space ("5 mm", "15°"), no
  exclamation marks, no emoji.

`CLAUDE.md` has the full list, and the decisions that need Kev's say before they change.
