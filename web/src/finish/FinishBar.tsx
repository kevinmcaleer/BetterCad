import { useState, type KeyboardEvent } from "react";
import { ArmedBar, Button, NumberField, evaluate } from "@bettercad/ui";
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
    <div role="group" aria-label={`Picked ${noun}`} className="bc-tools bc-armed bc-pick-list">
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
      <span className="bc-armed-note">Click {noun} in the view to add them.</span>
      <Button size="dense" label="Clear" title={`Take every ${noun === "edges" ? "edge" : "face"} out`} onClick={() => f.clear()} />
    </div>
  );
}

/** The strip for Fillet (round or bevel) and Shell: size, options, what is picked, Cancel and Done. */
export function FinishBar({ f, preview, onCancel }: { f: FinishSession; preview?: PreviewView; onCancel: () => void }) {
  const [listOpen, setListOpen] = useState(true);
  // Enter in the size field keeps the value, then makes the step.
  const onFieldKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || !f.part) return;
    // Use what the field holds now: its own commit has not rendered yet, and an Esc could follow at once.
    let v: number | undefined;
    try {
      v = evaluate((e.target as HTMLInputElement).value);
    } catch {
      return;
    }
    f.done(v > 0 ? v : undefined);
  };
  const n = f.refs.length;
  const shell = f.tool === "shell";
  const noun = shell ? "faces" : "edges";
  const count = n === 1 ? `1 ${noun.slice(0, -1)}` : `${n} ${noun}`;
  const list = n > 0 && listOpen ? <PickList f={f} noun={noun} /> : null;
  const listButton =
    n > 0 ? (
      <Button
        size="dense"
        icon="list"
        title={listOpen ? `Hide the list of picked ${noun}` : `Show the picked ${noun} as a list`}
        on={listOpen}
        aria-expanded={listOpen}
        onClick={() => setListOpen((o) => !o)}
      />
    ) : null;
  const error = preview?.error ? (
    <span role="alert" className="bc-armed-note bc-armed-error">
      {preview.error}
    </span>
  ) : null;
  if (shell) {
    return (
      <>
        {list}
        <ArmedBar title="Shell" icon="shell">
          <span className="bc-sk-fields" onKeyDown={onFieldKey}>
            <NumberField id="bc-finish-size" label="Wall" value={f.wall} min={0.2} onCommit={(v) => f.setWall(v)} />
          </span>
          <span role="group" aria-label="Direction" className="bc-segmented">
            <Button label="Inside" title="Keep the outer size" on={!f.outside} onClick={() => f.setOutside(false)} />
            <Button label="Outside" title="Grow the body by the wall" on={f.outside} onClick={() => f.setOutside(true)} />
          </span>
          {listButton}
          <span className="bc-armed-note">
            {!f.part ? "Click a face to leave open." : n ? `${count} open on ${f.partName}.` : "Sealed: a sealed hollow traps material when printed."}
          </span>
          {error}
          <Button kind="cancel" label="Cancel" title="Put the tool down" shortcut="Esc" onClick={onCancel} />
          <Button kind="done" label="Done" title="Hollow the body" shortcut="Enter" disabled={!f.part} onClick={() => f.done()} />
        </ArmedBar>
      </>
    );
  }
  return (
    <>
      {list}
      <ArmedBar title={f.bevel ? "Chamfer" : "Fillet"} icon={f.bevel ? "chamfer" : "fillet"}>
        <span role="group" aria-label="Edge shape" className="bc-segmented">
          <Button label="Round" title="Fillet: round the edges" on={!f.bevel} onClick={() => f.setBevel(false)} />
          <Button label="Bevel" title="Chamfer: cut the edges flat" on={f.bevel} onClick={() => f.setBevel(true)} />
        </span>
        <span className="bc-sk-fields" onKeyDown={onFieldKey}>
          <NumberField id="bc-finish-size" label={f.bevel ? "Distance" : "Radius"} value={f.radius} min={0.05} onCommit={(v) => f.setRadius(v)} />
        </span>
        {listButton}
        <span className="bc-armed-note">{f.part ? `${count} on ${f.partName}.` : "Click the edges to change."}</span>
        {error}
        <Button kind="cancel" label="Cancel" title="Put the tool down" shortcut="Esc" onClick={onCancel} />
        <Button kind="done" label="Done" title={f.bevel ? "Bevel the edges" : "Round the edges"} shortcut="Enter" disabled={!n} onClick={() => f.done()} />
      </ArmedBar>
    </>
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
