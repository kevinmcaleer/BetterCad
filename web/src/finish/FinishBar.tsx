import { useState, type KeyboardEvent } from "react";
import { Button, FeaturePanel, FeaturePicker, FeatureRow, NumberField, PanelNote, evaluate } from "@bettercad/ui";
import type { PreviewView } from "../kernel/usePreview";
import type { BodyMesh } from "@bettercad/kernel";
import type { FinishSession } from "./useFinish";

/**
 * The picked edges (or faces) as a list, like Fusion's: point at a row to light it up in the view, × to take
 * it out. Clicks in the view add more.
 */
function PickList({ f, noun }: { f: FinishSession; noun: "edges" | "faces" }) {
  const items = f.refs.map((index, n) => {
    const length = f.kind === "edge" && f.mesh ? edgeLength(f.mesh, index) : null;
    const name = `${f.kind === "edge" ? "Edge" : "Face"} ${n + 1}`;
    return { index, label: length !== null ? `${name}, ${formatMm(length)}` : name };
  });
  return (
    <div role="group" aria-label={`Picked ${noun}`} className="bc-pick-list">
      <ul>
        {items.map((it) => (
          <li key={it.index} onPointerEnter={() => f.point(it.index)} onPointerLeave={() => f.point(null)}>
            <span>{it.label}</span>
            <Button
              size="dense"
              icon="close"
              title={`Take ${it.label.split(",")[0]} out`}
              onClick={() => f.drop(it.index)}
              onFocus={() => f.point(it.index)}
              onBlur={() => f.point(null)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The panel for Fillet (fillet or chamfer) and Shell: what is picked, the size and options, Cancel and OK. */
export function FinishBar({ f, preview, onCancel }: { f: FinishSession; preview?: PreviewView; onCancel: () => void }) {
  const [listOpen, setListOpen] = useState(true);
  // Enter in the size field keeps the value, then makes the step.
  const onFieldEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!f.part) return;
    // Use what the field holds now: its own commit has not rendered yet, and an Esc could follow at once.
    let v: number | undefined;
    try {
      v = evaluate((e.target as HTMLInputElement).value);
    } catch {
      return;
    }
    f.done(f.tool === "offsetFace" ? v || undefined : v > 0 ? v : undefined);
  };
  const n = f.refs.length;
  const shell = f.tool === "shell";
  const noun = shell || f.tool === "offsetFace" ? "faces" : "edges";
  const picks = (
    <>
      <FeaturePicker
        label={shell ? "Open faces" : noun === "faces" ? "Faces" : "Edges"}
        count={n}
        empty={noun === "faces" ? "Click faces" : "Click edges"}
        picking
        title={n ? (listOpen ? `Hide the list of picked ${noun}` : `Show the picked ${noun} as a list`) : `Click ${noun} in the view to add them`}
        onPick={() => setListOpen((o) => !o)}
        onClear={() => f.clear()}
        clearTitle={`Take every ${noun === "edges" ? "edge" : "face"} out`}
      />
      {n > 0 && listOpen && <PickList f={f} noun={noun} />}
    </>
  );
  const error = preview?.error ? <PanelNote tone="error">{preview.error}</PanelNote> : null;
  const cancel = { title: "Put the tool down", onClick: onCancel };
  if (f.tool === "offsetFace") {
    return (
      <FeaturePanel
        title="Offset face"
        icon="offsetFace"
        onFieldEnter={onFieldEnter}
        cancel={cancel}
        ok={{ title: "Move the faces", disabled: !n, onClick: () => f.done() }}
      >
        {picks}
        <NumberField id="bc-finish-size" label="Distance" value={f.offsetBy} onCommit={(v) => f.setOffsetBy(v)} />
        <PanelNote>
          {f.part ? `${n === 1 ? "1 face" : `${n} faces`} on ${f.partName}. ` : "Click flat faces, or the wall of a hole. "}
          Out grows the body; a minus distance moves the faces in.
        </PanelNote>
        {error}
      </FeaturePanel>
    );
  }
  if (shell) {
    return (
      <FeaturePanel
        title="Shell"
        icon="shell"
        onFieldEnter={onFieldEnter}
        cancel={cancel}
        ok={{ title: "Hollow the body", disabled: !f.part, onClick: () => f.done() }}
      >
        {picks}
        <NumberField id="bc-finish-size" label="Wall" value={f.wall} min={0.2} onCommit={(v) => f.setWall(v)} />
        <FeatureRow label="Direction">
          <span role="group" aria-label="Direction" className="bc-segmented">
            <Button label="Inside" title="Keep the outer size" on={!f.outside} onClick={() => f.setOutside(false)} />
            <Button label="Outside" title="Grow the body by the wall" on={f.outside} onClick={() => f.setOutside(true)} />
          </span>
        </FeatureRow>
        <PanelNote>
          {!f.part
            ? "Click a face to leave open."
            : n
              ? `${n === 1 ? "1 face" : `${n} faces`} open on ${f.partName}.`
              : "Sealed: a sealed hollow traps material when printed."}
        </PanelNote>
        {error}
      </FeaturePanel>
    );
  }
  return (
    <FeaturePanel
      title={f.bevel ? "Chamfer" : "Fillet"}
      icon={f.bevel ? "chamfer" : "fillet"}
      onFieldEnter={onFieldEnter}
      cancel={cancel}
      ok={{ title: f.bevel ? "Chamfer the edges" : "Fillet the edges", disabled: !n, onClick: () => f.done() }}
    >
      {picks}
      <FeatureRow label="Shape">
        <span role="group" aria-label="Edge shape" className="bc-segmented">
          <Button label="Fillet" title="Round the edges" on={!f.bevel} onClick={() => f.setBevel(false)} />
          <Button label="Chamfer" title="Cut the edges off flat" on={f.bevel} onClick={() => f.setBevel(true)} />
        </span>
      </FeatureRow>
      <NumberField id="bc-finish-size" label={f.bevel ? "Distance" : "Radius"} value={f.radius} min={0.05} onCommit={(v) => f.setRadius(v)} />
      <PanelNote>{f.part ? `${n === 1 ? "1 edge" : `${n} edges`} on ${f.partName}.` : "Click the edges to change."}</PanelNote>
      {error}
    </FeaturePanel>
  );
}

/** An edge's length along its drawn segments, mm. */
export function edgeLength(m: BodyMesh, edge: number): number | null {
  if (edge < 0 || edge >= m.edgeSegs.length - 1) return null;
  let total = 0;
  const p = m.edgePositions;
  for (let s = m.edgeSegs[edge]!; s < m.edgeSegs[edge + 1]!; s++) {
    const o = s * 6;
    total += Math.hypot(p[o + 3]! - p[o]!, p[o + 4]! - p[o + 1]!, p[o + 5]! - p[o + 2]!);
  }
  return total;
}

/** "70 mm", "12.6 mm": a length as the bar shows it. */
export function formatMm(v: number): string {
  return `${Number(v.toFixed(v >= 100 ? 0 : 1))} mm`;
}
