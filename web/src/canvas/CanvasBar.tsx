import { useEffect, useState, type MutableRefObject } from "react";
import { Button, FeatureCheck, FeaturePanel, FeatureRow, NumberField, PanelNote } from "@bettercad/ui";
import { useCanvas, type CanvasDeps, type CanvasSession } from "./useCanvas";

/**
 * The Canvas tool (#248) with its panel, loaded when the tool is first picked. The editor keeps a handle for Enter and
 * the help line, and passes in a canvas to edit from the browser.
 */
export function CanvasTool({
  deps,
  edit,
  onEdited,
  onHelp,
  api,
}: {
  deps: CanvasDeps;
  edit: string | null;
  onEdited: () => void;
  onHelp: (help: string | null) => void;
  api: MutableRefObject<{ done(): void } | null>;
}) {
  const x = useCanvas(deps);
  api.current = x;
  useEffect(() => {
    if (!edit) return;
    x.edit(edit);
    onEdited();
  }, [edit, x, onEdited]);
  useEffect(() => onHelp(x.help), [x.help, onHelp]);
  useEffect(
    () => () => {
      onHelp(null);
      api.current = null;
    },
    [onHelp, api],
  );
  return <CanvasBar x={x} onCancel={x.cancel} />;
}

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * The panel for the Canvas tool (#248): the picture, its size, where it sits on its plane, its turn and flip, how
 * see-through it is, calibrating it to true size, and a lock.
 */
export function CanvasBar({ x, onCancel }: { x: CanvasSession; onCancel: () => void }) {
  const [keepShape, setKeepShape] = useState(true);
  const c = x.canvas;
  if (!c) {
    return (
      <FeaturePanel title="Canvas" icon="canvas" cancel={{ title: "Put the tool down", onClick: onCancel }}>
        <PanelNote>{x.help}</PanelNote>
      </FeaturePanel>
    );
  }
  const aspect = c.image.height / Math.max(1, c.image.width);
  const locked = !!c.locked;
  const k = x.calib;
  const measured = k?.a && k.b ? Math.hypot(k.b[0] - k.a[0], k.b[1] - k.a[1]) : null;
  return (
    <FeaturePanel
      title="Canvas"
      icon="canvas"
      onFieldEnter={() => (measured === null ? x.done() : undefined)}
      cancel={{ title: "Take the changes back", onClick: x.cancel }}
      ok={{ title: "Keep the canvas", onClick: x.done }}
    >
      <FeatureRow label="Picture">
        <Button label={c.image.file} title="Choose another picture" onClick={() => void x.changePicture()} disabled={x.busy || locked} />
      </FeatureRow>
      <NumberField
        label="Width"
        value={c.width}
        min={0.5}
        locked={locked}
        onCommit={(v) => x.change(keepShape ? { width: v, height: round(v * aspect) } : { width: v })}
      />
      <NumberField
        label="Height"
        value={c.height}
        min={0.5}
        locked={locked}
        onCommit={(v) => x.change(keepShape ? { height: v, width: round(v / aspect) } : { height: v })}
      />
      <FeatureCheck
        label="Keep its shape"
        title="Change the width and height together"
        on={keepShape}
        onChange={(on) => {
          setKeepShape(on);
          if (on && !locked) x.change({ height: round(c.width * aspect) });
        }}
      />
      <NumberField label="Across" value={c.x} locked={locked} onCommit={(v) => x.change({ x: v })} />
      <NumberField label="Up" value={c.y} locked={locked} onCommit={(v) => x.change({ y: v })} />
      <NumberField label="Turn" unit="°" value={c.angle} locked={locked} onCommit={(v) => x.change({ angle: ((((v + 180) % 360) + 360) % 360) - 180 })} />
      <FeatureCheck label="Flip" title="Mirror the picture left to right" on={!!c.flip} onChange={(on) => !locked && x.change({ flip: on || undefined })} />
      <NumberField
        label="Opacity"
        unit="%"
        value={Math.round(c.opacity * 100)}
        min={5}
        max={100}
        step={10}
        precision={0}
        onCommit={(v) => x.change({ opacity: v / 100 })}
      />
      {measured === null ? (
        <FeatureRow label="True size">
          <Button
            label={k ? "Stop calibrating" : "Calibrate"}
            title="Click two spots on the picture and type how far apart they really are"
            onClick={() => x.setCalib(k ? null : {})}
            disabled={locked}
          />
        </FeatureRow>
      ) : (
        <NumberField label="Distance" value={round(measured)} min={0.01} onCommit={(v) => x.calibrate(v)} />
      )}
      <FeatureCheck label="Lock" title="Keep the canvas where it is" on={locked} onChange={(on) => x.change({ locked: on || undefined })} />
      <PanelNote>{x.help}</PanelNote>
    </FeaturePanel>
  );
}
