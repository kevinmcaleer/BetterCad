# Accessibility conventions

- Focus: every control shows a 2px `accent` ring, offset 1px, on `:focus-visible`. The 3D view is focusable too.
- Tools are toggle buttons with `aria-pressed`. Icon-only buttons get their name from `title` (and `aria-label`).
- Every tool and command has a key, shown in its tooltip as "Label (K)" and listed under ? (Keyboard shortcuts). Ctrl+K (⌘K) finds any command.
- Single-letter keys never fire while you type in a field. Undo and redo inside a text field belong to the field.
- Esc backs out one layer: a menu or dialog first, then the armed tool, then the selection.
- Panels are landmarks: the rail is `navigation` "Panels", side panels are `complementary` with their title, the stage is `main`. The 3D view fills the window and the panels float over it, so each panel keeps its landmark and tab order: top bar, rail, left panel, tool bars, view, timeline, props panel.
- The status line is `aria-live="polite"`. Errors stay until replaced and are written in words, never colour alone.
- Contrast: `ink`/`muted` on `bar`, `rail`, `stage`, `hover`; `accent` on `bar`, `rail`, `accent-soft`; `on-accent` on `accent`; `warn-ink` on `warn-soft`; `danger` on `bar`, `rail` all hold 4.5:1 in every theme (`packages/ui/src/tokens.test.ts`).
- `prefers-reduced-motion` turns transitions and animations off.
- The 3D canvas cannot be fully accessible in v1; the status line names the selection and the active tool so a screen reader user can follow along (epic #3).
