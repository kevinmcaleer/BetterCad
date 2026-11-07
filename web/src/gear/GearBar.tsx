import { useState, type KeyboardEvent } from "react";
import { ArmedBar, Button, NumberField } from "@bettercad/ui";
import { gearCircles, undercutWarning, type GearBore, type GearParams } from "../state/document";
import type { GearSession } from "./useGear";

const BORES: { id: GearBore["kind"]; label: string; title: string; diameter: number }[] = [
  { id: "none", label: "None", title: "No hole in the middle", diameter: 0 },
  { id: "round", label: "Round", title: "A round hole for a shaft or bearing pin", diameter: 5 },
  { id: "dflat", label: "D-flat", title: "A round hole with a flat, for a motor's D shaft", diameter: 3 },
  { id: "horn", label: "Servo horn", title: "A hub hole and four arm holes, to bolt to a servo horn", diameter: 7 },
];

const round = (v: number) => Math.round(v * 100) / 100;

/** The strip for Spur gear (#191): teeth, module, width and bore, with the finer settings under More. */
export function GearBar({ x, error, onCancel }: { x: GearSession; error?: string; onCancel: () => void }) {
  const [more, setMore] = useState(false);
  const f = x.feature;
  if (!f) {
    return (
      <ArmedBar title="Spur gear" icon="gear">
        <span className="bc-armed-note">{x.help}</span>
        <Button kind="cancel" label="Cancel" title="Put the tool down" shortcut="Esc" onClick={onCancel} />
      </ArmedBar>
    );
  }
  const onFieldKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") x.done();
  };
  const g = f.gear;
  const set = (c: Partial<GearParams>) => x.change({ gear: { ...g, ...c } });
  const b = f.bore;
  const pitch = round(2 * gearCircles(g).pitch);
  const warning = undercutWarning(g);
  return (
    <ArmedBar title="Spur gear" icon="gear">
      <span className="bc-sk-fields" onKeyDown={onFieldKey}>
        <NumberField label="Teeth" value={g.teeth} min={6} max={400} step={1} precision={0} onCommit={(v) => set({ teeth: Math.round(v) })} />
        <NumberField label="Module" unit="mm" value={g.module} min={0.1} step={0.1} onCommit={(v) => set({ module: v })} />
        <NumberField label="Width" unit="mm" value={f.width} min={0.1} onCommit={(v) => x.change({ width: v })} />
      </span>
      <span className="bc-armed-note">Pitch diameter {pitch} mm</span>
      <span role="group" aria-label="Bore" className="bc-segmented">
        {BORES.map((o) => (
          <Button
            key={o.id}
            label={o.label}
            title={o.title}
            on={b.kind === o.id}
            onClick={() => x.change({ bore: { kind: o.id, diameter: o.diameter, ...(o.id === "dflat" ? { flat: 1.2 } : o.id === "horn" ? { arm: 7 } : {}) } })}
          />
        ))}
      </span>
      {b.kind !== "none" && (
        <span className="bc-sk-fields" onKeyDown={onFieldKey}>
          <NumberField
            label={b.kind === "horn" ? "Horn hub" : "Bore"}
            unit="mm"
            value={b.diameter}
            min={0.1}
            onCommit={(v) => x.change({ bore: { ...b, diameter: v } })}
          />
          {b.kind === "dflat" && (
            <NumberField
              label="Flat from centre"
              unit="mm"
              value={b.flat ?? round(b.diameter * 0.4)}
              min={0}
              onCommit={(v) => x.change({ bore: { ...b, flat: v } })}
            />
          )}
          {b.kind === "horn" && <NumberField label="Arm holes" unit="mm" value={b.arm ?? 7} min={0.1} onCommit={(v) => x.change({ bore: { ...b, arm: v } })} />}
        </span>
      )}
      <Button label="More" title="Pressure angle, backlash, clearance, profile shift and hub" on={more} onClick={() => setMore((m) => !m)} />
      {more && (
        <span className="bc-sk-fields" onKeyDown={onFieldKey}>
          <NumberField label="Pressure angle" unit="°" value={g.pressure} min={10} max={35} onCommit={(v) => set({ pressure: v })} />
          <NumberField label="Backlash" unit="mm" value={g.backlash} min={0} step={0.05} onCommit={(v) => set({ backlash: v })} />
          <NumberField label="Tip clearance" value={g.clearance} min={0} step={0.05} onCommit={(v) => set({ clearance: v })} />
          <NumberField label="Profile shift" value={g.shift} step={0.05} onCommit={(v) => set({ shift: v })} />
          <NumberField
            label="Hub"
            unit="mm"
            value={f.hub?.diameter ?? 0}
            min={0}
            onCommit={(v) => x.change({ hub: v > 0 ? { diameter: v, length: f.hub?.length || 4 } : undefined })}
          />
          {f.hub && <NumberField label="Hub length" unit="mm" value={f.hub.length} min={0} onCommit={(v) => x.change({ hub: { ...f.hub!, length: v } })} />}
        </span>
      )}
      {warning && !error && <span className="bc-armed-note">{warning}</span>}
      {more && <span className="bc-armed-note">Backlash starts at your printer's press fit. Clearance and shift are shares of the module.</span>}
      {error && (
        <span className="bc-armed-note bc-armed-error" role="alert">
          {error}
        </span>
      )}
      <Button kind="cancel" label="Cancel" title="Take the gear back" shortcut="Esc" onClick={x.cancel} />
      <Button kind="done" label="Done" title="Keep the gear" shortcut="Enter" onClick={x.done} />
    </ArmedBar>
  );
}
