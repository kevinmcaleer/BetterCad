# @bettercad/ui

BetterCad's design system in code: tokens, component CSS, icons and React components.

The source of truth is the design system artifact: https://claude.ai/artifact/MfEzeMVbydgaztQzHAHKTN

- `src/tokens.json` is a copy of the design system's `project/tokens.json`.
- `src/tokens.css` and `src/tokens.ts` are generated from it. Never edit them by hand.
- `src/components.css` is the design system's `components/bundle.css`, with every variable renamed to the `--bc-*` form.
- `src/icons.ts` holds the icon paths from the design system's bundle (Layers' set plus BetterCad's modelling icons).

## Re-sync from the design system

1. Download `project/tokens.json` from the design system and replace `src/tokens.json`.
2. Run `npm run tokens` from the repo root.
3. Run `npm test`: the contrast test fails if a text pair drops under 4.5:1 in any theme. Fix the token in the design system, not here.

## Variables

| Token family | CSS variable |
| --- | --- |
| Colour | `--bc-color-<name>`, per theme under `[data-theme="light|dark|holodeck"]` |
| Spacing | `--bc-space-1` to `--bc-space-8`, `--bc-control`, `--bc-rail-width`, `--bc-side-width` |
| Radius | `--bc-radius-sm/md/lg/xl/pill` |
| Shadow | `--bc-shadow-float/frame/pop/dialog/editor` |
| Type | `--bc-type-<name>-size/-line/-weight`, and a `.bc-type-<name>` class |

Components never use a literal colour. A test fails if one appears in `components.css`.
