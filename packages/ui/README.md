# @bettercad/ui

BetterCad's design system in code: tokens, component CSS, icons and React components.

The source of truth is the design system artifact: https://claude.ai/artifact/MfEzeMVbydgaztQzHAHKTN

- `src/tokens.json` is a copy of the design system's `project/tokens.json`.
- `src/tokens.css` and `src/tokens.ts` are generated from it. Never edit them by hand.
- `src/styles/*.css` is the design system's `components/bundle.css`, split one file per component, with every variable renamed to the `--bc-*` form. `src/index.css` imports tokens then every sheet.
- `src/icons.ts` holds the icon paths from the design system's bundle (Layers' set plus BetterCad's modelling icons).

## Re-sync from the design system

1. Download `project/tokens.json` from the design system and replace `src/tokens.json`.
2. Run `npm run tokens` from the repo root.
3. Run `npm test`: the contrast test fails if a text pair drops under 4.5:1 in any theme. Fix the token in the design system, not here.

## Layout

The 3D workspace fills the whole window. Everything else floats over it: the top bar, the rail, the side panels, the tool bars, the timeline, the help line and any overlay are cards (`--bc-color-bar`, a 1px `--bc-color-line` border, `--bc-radius-lg`, `--bc-shadow-float`) set `--bc-space-4` in from the window edge and from each other. Nothing docks beside the view or frames it. Panels are as tall as their content, so more of the model shows.

In the editor, `.bc-app` sets `--bc-view-top`, `--bc-view-left`, `--bc-view-right` and `--bc-view-bottom`: the part of the view no card covers. Anything drawn inside the view (the view cube, hints, the empty state, stats) uses them to stay clear. Under 900px the rail floats along the bottom and the panels are sheets just above it.

## Variables

| Token family | CSS variable |
| --- | --- |
| Colour | `--bc-color-<name>`, per theme under `[data-theme="light|dark|holodeck"]` |
| Spacing | `--bc-space-1` to `--bc-space-8`, `--bc-control`, `--bc-rail-width`, `--bc-side-width` |
| Radius | `--bc-radius-sm/md/lg/xl/pill` |
| Shadow | `--bc-shadow-float/frame/pop/dialog/editor` |
| Type | `--bc-type-<name>-size/-line/-weight`, and a `.bc-type-<name>` class |

Components never use a literal colour. A test fails if one appears in any sheet under `src/styles/`.
