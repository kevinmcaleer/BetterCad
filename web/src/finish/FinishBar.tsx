import type { KeyboardEvent } from "react";
import { ArmedBar, Button, NumberField, evaluate } from "@bettercad/ui";
import type { FinishSession } from "./useFinish";

/** The strip for Fillet (round or bevel) and Shell: size, options, what is picked, Cancel and Done. */
export function FinishBar({ f, onCancel }: { f: FinishSession; onCancel: () => void }) {
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
  if (f.tool === "shell") {
    return (
      <ArmedBar title="Shell" icon="shell">
        <span className="bc-sk-fields" onKeyDown={onFieldKey}>
          <NumberField id="bc-finish-size" label="Wall" value={f.wall} min={0.2} onCommit={(v) => f.setWall(v)} />
        </span>
        <span role="group" aria-label="Direction" className="bc-segmented">
          <Button label="Inside" title="Keep the outer size" on={!f.outside} onClick={() => f.setOutside(false)} />
          <Button label="Outside" title="Grow the body by the wall" on={f.outside} onClick={() => f.setOutside(true)} />
        </span>
        <span className="bc-armed-note">
          {!f.part
            ? "Click a face to leave open."
            : n
              ? `${n === 1 ? "1 face" : `${n} faces`} open on ${f.partName}.`
              : "Sealed: a sealed hollow traps material when printed."}
        </span>
        <Button kind="cancel" label="Cancel" title="Put the tool down" shortcut="Esc" onClick={onCancel} />
        <Button kind="done" label="Done" title="Hollow the body" shortcut="Enter" disabled={!f.part} onClick={() => f.done()} />
      </ArmedBar>
    );
  }
  return (
    <ArmedBar title={f.bevel ? "Chamfer" : "Fillet"} icon={f.bevel ? "chamfer" : "fillet"}>
      <span role="group" aria-label="Edge shape" className="bc-segmented">
        <Button label="Round" title="Fillet: round the edges" on={!f.bevel} onClick={() => f.setBevel(false)} />
        <Button label="Bevel" title="Chamfer: cut the edges flat" on={f.bevel} onClick={() => f.setBevel(true)} />
      </span>
      <span className="bc-sk-fields" onKeyDown={onFieldKey}>
        <NumberField id="bc-finish-size" label={f.bevel ? "Distance" : "Radius"} value={f.radius} min={0.05} onCommit={(v) => f.setRadius(v)} />
      </span>
      <span className="bc-armed-note">{f.part ? `${n === 1 ? "1 edge" : `${n} edges`} on ${f.partName}.` : "Click the edges to change."}</span>
      <Button kind="cancel" label="Cancel" title="Put the tool down" shortcut="Esc" onClick={onCancel} />
      <Button kind="done" label="Done" title={f.bevel ? "Bevel the edges" : "Round the edges"} shortcut="Enter" disabled={!n} onClick={() => f.done()} />
    </ArmedBar>
  );
}
