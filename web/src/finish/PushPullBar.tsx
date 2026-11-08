import type { KeyboardEvent } from "react";
import { FeaturePanel, NumberField, PanelNote, evaluate } from "@bettercad/ui";
import type { PushPullSession } from "./usePushPull";

/** The panel for Push/pull: how far the face moves (out adds, in cuts), Cancel and OK. */
export function PushPullBar({ x, error, onCancel }: { x: PushPullSession; error?: string; onCancel: () => void }) {
  if (!x.session) {
    return (
      <FeaturePanel title="Push/pull" icon="pushpull" cancel={{ title: "Put the tool down", onClick: onCancel }}>
        <PanelNote>{x.help}</PanelNote>
      </FeaturePanel>
    );
  }
  // Enter keeps what the field holds now: its own commit has not rendered yet, and an Esc could follow at once.
  const onFieldEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    let v: number | undefined;
    try {
      v = evaluate((e.target as HTMLInputElement).value);
    } catch {
      return;
    }
    x.done(v);
  };
  return (
    <FeaturePanel
      title="Push/pull"
      icon="pushpull"
      onFieldEnter={onFieldEnter}
      cancel={{ title: "Take the push/pull back", onClick: x.cancel }}
      ok={{ title: "Keep the push/pull", onClick: () => x.done() }}
    >
      <NumberField id="bc-pp-distance" label="Distance" value={x.distance} onCommit={(v) => x.setDistance(v)} />
      <PanelNote>{x.distance > 0 ? `Adds to ${x.partName}.` : x.distance < 0 ? `Cuts into ${x.partName}.` : "Drag out to add, in to cut."}</PanelNote>
      {error && <PanelNote tone="error">{error}</PanelNote>}
    </FeaturePanel>
  );
}
