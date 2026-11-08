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

## Pull requests

The [pull request template](.github/pull_request_template.md) asks for What, Why, the release note, How tested,
Screenshots and Budget impact. Screenshots for UI changes can come from the component gallery (`#/gallery` in `make dev`). CI comments with
the performance budgets; say in the description if a number moved on purpose.

## Release notes

Every pull request that changes something people see adds one release note: a Markdown file in
[`web/src/whatsnew/notes/`](web/src/whatsnew/notes). After an update, the app shows a small card naming the new
features, and Help → What's new lists them all.

- Name the file `YYYY-MM-DD-short-name.md`, with the day you open the pull request, in lower case with hyphens:
  `2026-11-08-mirror.md`. One file per pull request, so pull requests never conflict over it.
- The first line is the feature name as a heading, in sentence case, 60 characters at most: `# Mirror across a face`.
- Below it, a sentence or two (or a short `- ` list) on what you can now do, written for the person using BetterCad,
  not for developers. `**bold**` and `` `code` `` work; nothing else does. 400 characters at most.
- A fix to something already released can skip the note, or say what now works ("Paper renders keep their colours").
  CI-only, test-only and docs-only changes don't need one.
- A test (`web/src/whatsnew/notes.test.ts`) checks every file against these rules.

```md
# Mirror across a face

Mirror bodies, features or a whole component across a face or an origin plane.
```

`CHANGELOG.md` stays the per-version summary for a tagged release.

## Writing UI text

BetterCad talks like a helpful maker at the next bench:

- Short and in the second person: "Click a flat face where the hole goes."
- Sentence case for everything, including buttons and titles.
- Units with a space: "5 mm", "15°", "1,200 mm²".
- No exclamation marks, no emoji, no "Oops".
- An error says what happened and what to do next: "Couldn't fillet: the radius is bigger than the edge. Try 2 mm."

## Issues and triage

Bugs, features and questions each have an issue form. Kev triages weekly; see [TRIAGE.md](TRIAGE.md).

`CLAUDE.md` has the full list, and the decisions that need Kev's say before they change.
