# Accessibility conventions

- Focus: every control shows a 2px `accent` ring, offset 1px, on `:focus-visible`. The 3D view is focusable too.
- Tools are toggle buttons with `aria-pressed`. Icon-only buttons get their name from `title` (and `aria-label`).
- Every tool and command has a key, shown in its tooltip as "Label (K)" and listed under ? (Keyboard shortcuts). Ctrl+K (⌘K) finds any command.
- Single-letter keys never fire while you type in a field. Undo and redo inside a text field belong to the field.
- Esc backs out one layer: a menu or dialog first, then the armed tool, then the selection.
- Panels are landmarks: the top bar is the `banner` and holds the "Model tools" toolbar, side panels are `complementary` with their title, the stage is `main`. The 3D view fills the window and the panels float over it, so each panel keeps its landmark and tab order: top bar, left panel, tool bars, view, timeline, props panel.
- The status line is `aria-live="polite"`. Errors stay until replaced and are written in words, never colour alone.
- Contrast: `ink`/`muted` on `bar`, `rail`, `stage`, `hover`; `accent` on `bar`, `rail`, `accent-soft`; `on-accent` on `accent`; `warn-ink` on `warn-soft`; `danger` on `bar`, `rail` all hold 4.5:1 in every theme (`packages/ui/src/tokens.test.ts`).
- `prefers-reduced-motion` turns transitions and animations off.
- The 3D canvas cannot be fully accessible in v1; the status line names the selection and the active tool so a screen reader user can follow along (epic #3).
- Drawings: the sheet is an SVG `group` named for its page. Each view, mark and dimension on it is a `button` you can tab to, named for what it is and what it reads ("Top view, 2:1", "Centre mark", "Dimension, 40 mm"). Arrow keys nudge a view or a size, Delete removes it, and the menu key (or Shift+F10) opens the menu of a view, a size or a warning. While a tool is armed, the edges, holes and points it can use are buttons too ("Edge, 40 mm long", "Hole, 4.5 mm across"), so every tool works without a pointer. A mark or dimension that lost its edge is a button that says so. Base view (B), Projected view (P), Centre mark (C), Dimension (D) and Fit sheet (F) have keys; the rest are under Ctrl+K. Paper stays white with dark ink in every theme, and `paper-ink` and `paper-pick` hold their contrast on `paper`. The sheets of a drawing are a `tablist` under the page: arrow keys, Home and End switch sheets, F2 renames, Delete deletes and Alt with an arrow reorders. axe runs on the sheet and its cards in all three themes (`web/e2e/drawing.spec.ts`).
