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
