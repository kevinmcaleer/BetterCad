import { useState } from "react";
import { Button, FeatureCheck, FeaturePanel, FeatureRow, NumberField, PanelNote } from "@bettercad/ui";
import type { DecalSession } from "./useDecal";

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * The panel for the Decal tool (#263): the picture, its size (its shape kept unless you unlock it), where it sits on
 * the face, its turn and a flip.
 */
export function DecalBar({ x, error, onCancel }: { x: DecalSession; error?: string; onCancel: () => void }) {
  const [keepShape, setKeepShape] = useState(true);
  const f = x.feature;
  if (!f) {
    return (
      <FeaturePanel title="Decal" icon="image" cancel={{ title: "Put the tool down", onClick: onCancel }}>
        <PanelNote>{x.help}</PanelNote>
      </FeaturePanel>
    );
  }
  const aspect = f.image.height / Math.max(1, f.image.width);
  return (
    <FeaturePanel
      title="Decal"
      icon="image"
      onFieldEnter={() => x.done()}
      cancel={{ title: "Take the decal back", onClick: x.cancel }}
      ok={{ title: "Keep the decal", onClick: x.done }}
    >
      <FeatureRow label="Picture">
        <Button label={f.image.file} title="Choose another picture" onClick={() => void x.changePicture()} disabled={x.busy} />
      </FeatureRow>
      <NumberField label="Width" value={f.width} min={0.5} onCommit={(v) => x.change(keepShape ? { width: v, height: round(v * aspect) } : { width: v })} />
      <NumberField label="Height" value={f.height} min={0.5} onCommit={(v) => x.change(keepShape ? { height: v, width: round(v / aspect) } : { height: v })} />
      <FeatureCheck
        label="Keep its shape"
        title="Change the width and height together"
        on={keepShape}
        onChange={(on) => {
          setKeepShape(on);
          if (on) x.change({ height: round(f.width * aspect) });
        }}
      />
      <NumberField label="Across" value={f.x} onCommit={(v) => x.change({ x: v })} />
      <NumberField label="Up" value={f.y} onCommit={(v) => x.change({ y: v })} />
      <NumberField label="Turn" unit="°" value={f.angle} onCommit={(v) => x.change({ angle: ((((v + 180) % 360) + 360) % 360) - 180 })} />
      <FeatureCheck label="Flip" title="Mirror the picture left to right" on={!!f.flip} onChange={(on) => x.change({ flip: on || undefined })} />
      <PanelNote>{x.help}</PanelNote>
      {error && <PanelNote tone="error">{error}</PanelNote>}
    </FeaturePanel>
  );
}
