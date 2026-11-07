import type { KeyboardEvent } from "react";
import { ArmedBar, Button, MenuButton, NumberField, type MenuEntry } from "@bettercad/ui";
import { FITS, SCREWS, resolveHole } from "../state/document";
import type { HoleSession } from "./useHole";

const HEADS = [
  { id: "none", label: "Plain", title: "A straight hole" },
  { id: "countersink", label: "Countersink", title: "A cone for a countersunk screw head to sit flush" },
  { id: "counterbore", label: "Counterbore", title: "A wider step for a socket head to sit flush" },
] as const;

/** The strip for Hole: size, fit, head, depth, where the last hole sits, Cancel and Done. */
export function HoleBar({ x, error, onCancel }: { x: HoleSession; error?: string; onCancel: () => void }) {
  const f = x.feature;
  if (!f) {
    return (
      <ArmedBar title="Hole" icon="hole">
        <span className="bc-armed-note">{x.help}</span>
        <Button kind="cancel" label="Cancel" title="Put the tool down" shortcut="Esc" onClick={onCancel} />
      </ArmedBar>
    );
  }
  // Enter in a field: its own commit has gone into the document, so finish now.
  const onFieldKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") x.done();
  };
  const sizes: MenuEntry[] = [
    { kind: "title", id: "metric", label: "Metric" },
    ...SCREWS.filter((s) => s.system === "metric").map((s) => ({
      id: s.id,
      label: s.label,
      checked: f.size === s.id,
      onSelect: () => x.change({ size: s.id }),
    })),
    { kind: "title", id: "imperial", label: "Imperial" },
    ...SCREWS.filter((s) => s.system === "imperial").map((s) => ({
      id: s.id,
      label: s.label,
      checked: f.size === s.id,
      onSelect: () => x.change({ size: s.id }),
    })),
    { kind: "separator", id: "sep" },
    {
      id: "custom",
      label: "Custom diameter",
      checked: f.size === "custom",
      onSelect: () => x.change({ size: "custom", head: "none", diameter: f.diameter ?? 5 }),
    },
  ];
  const fits: MenuEntry[] = FITS.map((t) => ({ id: t.id, label: t.label, checked: f.fit === t.id, onSelect: () => x.change({ fit: t.id }) }));
  const fit = FITS.find((t) => t.id === f.fit)!;
  const r = resolveHole(f);
  const dia = "diameter" in r ? `${Math.round(r.diameter * 100) / 100} mm` : "";
  const n = f.points.length;
  const lastPoint = f.points[n - 1];
  const move = (axis: 0 | 1, v: number) =>
    x.change({ points: f.points.map((p, i) => (i === n - 1 ? ((axis ? [p[0], v] : [v, p[1]]) as [number, number]) : p)) });
  const custom = f.size === "custom";
  return (
    <ArmedBar title="Hole" icon="hole">
      <MenuButton label="Size" entries={sizes} trigger={(p) => <Button {...p} label={custom ? "Custom" : f.size} title="The screw size" />} />
      {custom ? (
        <span className="bc-sk-fields" onKeyDown={onFieldKey}>
          <NumberField label="Diameter" value={f.diameter ?? 5} min={0.1} onCommit={(v) => x.change({ diameter: v })} />
        </span>
      ) : (
        <>
          <MenuButton label="Fit" entries={fits} trigger={(p) => <Button {...p} label={fit.label} title={fit.title} />} />
          <span role="group" aria-label="Head" className="bc-segmented">
            {HEADS.map((h) => (
              <Button key={h.id} label={h.label} title={h.title} on={f.head === h.id} onClick={() => x.change({ head: h.id })} />
            ))}
          </span>
        </>
      )}
      <span className="bc-sk-fields" onKeyDown={onFieldKey}>
        {f.depth !== null && <NumberField id="bc-hole-depth" label="Depth" value={f.depth} min={0.1} onCommit={(v) => x.change({ depth: v })} />}
        {lastPoint && (
          <>
            <NumberField label={n > 1 ? `Hole ${n} X` : "Hole X"} value={lastPoint[0]} onCommit={(v) => move(0, v)} />
            <NumberField label={n > 1 ? `Hole ${n} Y` : "Hole Y"} value={lastPoint[1]} onCommit={(v) => move(1, v)} />
          </>
        )}
      </span>
      <Button label="Through all" title="Go right through the body" on={f.depth === null} onClick={() => x.change({ depth: f.depth === null ? 5 : null })} />
      <span className="bc-armed-note">
        {n === 1 ? "1 hole" : `${n} holes`}
        {dia && `, ${dia}`}. X and Y are from the face's centre.
      </span>
      {n > 1 && <Button label="Remove last" title="Take the last hole out" onClick={() => x.change({ points: f.points.slice(0, -1) })} />}
      {error && (
        <span className="bc-armed-note bc-armed-error" role="alert">
          {error}
        </span>
      )}
      <Button kind="cancel" label="Cancel" title="Take the holes back" shortcut="Esc" onClick={x.cancel} />
      <Button kind="done" label="Done" title="Keep the holes" shortcut="Enter" onClick={x.done} />
    </ArmedBar>
  );
}
