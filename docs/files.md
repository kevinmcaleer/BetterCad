# Files

## .bcad

A BetterCad model is a `.bcad` file: pretty-printed JSON (MIME type `application/vnd.bettercad+json`) that holds
the timeline, sketches, parameters, named views, body names and looks, and a 320 × 200 PNG thumbnail. It never
holds geometry or meshes; opening a file rebuilds the model from its steps.

```json
{
  "schema": 1,
  "app": "bettercad",
  "version": "0.1.0",
  "id": "m…",
  "created": "2026-11-07T10:00:00.000Z",
  "modified": "2026-11-07T10:05:00.000Z",
  "name": "Bracket",
  "document": { "format": "bettercad", "version": 2, "name": "Bracket", "features": [], "looks": {} },
  "thumbnail": "data:image/png;base64,…"
}
```

- The schema is [`packages/kernel/src/bcad.schema.json`](../packages/kernel/src/bcad.schema.json); files are checked
  against it when they load.
- Document keys are written in sorted order with 2-space indents, so the same model always writes the same bytes and
  a diff shows only what changed.
- Older files are migrated forward one schema at a time (`packages/kernel/src/migrations/`). Schema 0 is the bare
  document the editor downloaded before `.bcad` (`*.bettercad.json`); those still open.
- A file from a newer BetterCad opens with a warning. Steps this version doesn't know are kept and saved back
  unchanged; they show as problems on the timeline.

## Saving

In Chrome and Edge, Save writes back to the file you opened or last saved, without a dialog, and the file joins
Recent files in the Save menu. Save as picks a new file, and the model takes the file's name. In Safari and Firefox,
Save downloads a `.bcad`.

| Command     | Keys            |
| ----------- | --------------- |
| New model   | Ctrl+N          |
| Open…       | Ctrl+O          |
| Save        | Ctrl+S          |
| Save as…    | Ctrl+Shift+S    |

## Autosave

Every change is written to this browser's storage (IndexedDB) 3 seconds after you stop, and at once when the tab is
hidden or closed. If a model has changes that never reached a file, the next visit offers to recover it. Discard
keeps the copy for a day before it is gone. The last 20 models are kept.

## Export

Export (Ctrl+E, or Export in the Save menu) writes files for printing and for other CAD tools. Every export comes from
the exact solids in the geometry engine, never from what the view draws.

| Format | For                                     | What's in it                                                               |
| ------ | --------------------------------------- | -------------------------------------------------------------------------- |
| STL    | Any slicer                              | Binary triangles, "BetterCad name" in the header                           |
| 3MF    | Modern slicers (Prusa, Bambu, Cura)     | Millimetres, the model's title, one named object per body                  |
| STEP   | Fusion, FreeCAD, Onshape, CNC           | AP214 exact solids in millimetres, each body named                         |

- Resolution sets how far the triangles may stray from the true surface: Draft 0.1 mm, Normal 0.02 mm, Fine
  0.005 mm, or a custom value. It's an absolute distance, so small and large parts get the same accuracy. STEP is
  exact and has no resolution.
- The dialog estimates the triangle count and file size before you export; the export reuses those triangles.
- Place on the bed moves everything so the lowest point is at Z = 0. Turn it off to keep the model's coordinates.
- All bodies go in one file, or pick Selected, or Each on its own for one file per body (in Chrome and Edge you pick a
  folder; elsewhere each file downloads).
- Hole shapes that haven't been grouped with a solid are left out, with a warning and a Group them now button.

## Import

Open (Ctrl+O) also takes STL, STEP (.step, .stp) and 3MF files, and so does dropping them on the view or pasting them.
They're added to the open model as an Import step on the timeline; a dropped file stands where you drop it on the grid.

- STEP files come in as exact solids, one body per solid. They work with every tool, fillets included.
- STL and 3MF files come in as mesh bodies: their triangles are sewn into a solid, and flat runs of triangles merge
  into single faces. You can move, turn, measure and combine them, but not fillet, chamfer, shell or push/pull them.
  Use a STEP file for that.
- A mesh with gaps stays open and can't be combined; BetterCad says so when you import it.
- The file's bytes are kept in the `.bcad` (by content hash, once per file), so the model rebuilds without the
  original.
- Drop a `.bcad` to open it; BetterCad asks first if you have unsaved changes.
