import type { KeyboardEvent } from "react";
import { ArmedBar, Button, NumberField, evaluate } from "@bettercad/ui";
import type { PushPullSession } from "./usePushPull";

/** The strip for Push/pull: how far the face moves (out adds, in cuts), Cancel and Done. */
export function PushPullBar({ x, error, onCancel }: { x: PushPullSession; error?: string; onCancel: () => void }) {
  if (!x.session) {
    return (
      <ArmedBar title="Push/pull" icon="pushpull">
        <span className="bc-armed-note">{x.help}</span>
        <Button kind="cancel" label="Cancel" title="Put the tool down" shortcut="Esc" onClick={onCancel} />
      </ArmedBar>
    );
  }
  // Enter keeps what the field holds now: its own commit has not rendered yet, and an Esc could follow at once.
  const onFieldKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    let v: number | undefined;
    try {
      v = evaluate((e.target as HTMLInputElement).value);
    } catch {
      return;
    }
    x.done(v);
  };
  return (
    <ArmedBar title="Push/pull" icon="pushpull">
      <span className="bc-sk-fields" onKeyDown={onFieldKey}>
        <NumberField id="bc-pp-distance" label="Distance" value={x.distance} onCommit={(v) => x.setDistance(v)} />
      </span>
      <span className="bc-armed-note">
        {x.distance > 0 ? `Adds to ${x.partName}.` : x.distance < 0 ? `Cuts into ${x.partName}.` : "Drag out to add, in to cut."}
      </span>
      {error && (
        <span className="bc-armed-note bc-armed-error" role="alert">
          {error}
        </span>
      )}
      <Button kind="cancel" label="Cancel" title="Take the push/pull back" shortcut="Esc" onClick={x.cancel} />
      <Button kind="done" label="Done" title="Keep the push/pull" shortcut="Enter" onClick={() => x.done()} />
    </ArmedBar>
  );
}
