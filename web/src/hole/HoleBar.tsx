import { Button, FeatureCheck, FeaturePanel, FeatureRow, MenuButton, NumberField, PanelNote, type MenuEntry } from "@bettercad/ui";
import { DEFAULT_HOLE_OFFSET, FITS, SCREWS, fitLabel, fitNote, resolveHole, screw } from "../state/document";
import type { HoleSession } from "./useHole";

const HEADS = [
  { id: "none", label: "Plain", title: "A straight hole" },
  { id: "countersink", label: "Countersink", title: "A cone for a countersunk screw head to sit flush" },
  { id: "counterbore", label: "Counterbore", title: "A wider step for a socket head to sit flush" },
] as const;

/** The panel for Hole: size, fit, head, depth, where the last hole sits, Cancel and OK. */
export function HoleBar({ x, error, onCancel }: { x: HoleSession; error?: string; onCancel: () => void }) {
  const f = x.feature;
  if (!f) {
    return (
      <FeaturePanel title="Hole" icon="hole" cancel={{ title: "Put the tool down", onClick: onCancel }}>
        <PanelNote>{x.help}</PanelNote>
      </FeaturePanel>
    );
  }
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
  const s = screw(f.size);
  const offset = f.offset ?? DEFAULT_HOLE_OFFSET;
  // Each fit with what it comes to for this size (#104); an insert hole is blind, as deep as the insert and 1 mm more.
  const fits: MenuEntry[] = FITS.map((t) => ({
    id: t.id,
    label: s ? fitLabel(s, t.id, offset) : t.label,
    checked: f.fit === t.id,
    disabled: t.id === "insert" && !s?.insert,
    onSelect: () => x.change(t.id === "insert" && s?.insert && f.depth === null ? { fit: t.id, depth: s.insert.depth + 1 } : { fit: t.id }),
  }));
  const fit = FITS.find((t) => t.id === f.fit)!;
  const note = s ? fitNote(s, f.fit, offset) : null;
  const r = resolveHole(f);
  const dia = "diameter" in r ? `${Math.round(r.diameter * 100) / 100} mm` : "";
  const n = f.points.length;
  const lastPoint = f.points[n - 1];
  const move = (axis: 0 | 1, v: number) =>
    x.change({ points: f.points.map((p, i) => (i === n - 1 ? ((axis ? [p[0], v] : [v, p[1]]) as [number, number]) : p)) });
  const custom = f.size === "custom";
  return (
    <FeaturePanel
      title="Hole"
      icon="hole"
      // Enter in a field: its own commit has gone into the document, so finish now.
      onFieldEnter={() => x.done()}
      cancel={{ title: "Take the holes back", onClick: x.cancel }}
      ok={{ title: "Keep the holes", onClick: x.done }}
    >
      <FeatureRow label="Size">
        <MenuButton label="Size" entries={sizes} trigger={(p) => <Button {...p} label={custom ? "Custom" : f.size} title="The screw size" />} />
      </FeatureRow>
      {custom ? (
        <NumberField label="Diameter" value={f.diameter ?? 5} min={0.1} onCommit={(v) => x.change({ diameter: v })} />
      ) : (
        <>
          <FeatureRow label="Fit">
            <MenuButton label="Fit" entries={fits} trigger={(p) => <Button {...p} label={s ? fitLabel(s, f.fit, offset) : fit.label} title={fit.title} />} />
          </FeatureRow>
          {note && <PanelNote>{note}</PanelNote>}
          <FeatureRow label="Head">
            <span role="group" aria-label="Head" className="bc-segmented">
              {HEADS.map((h) => (
                <Button key={h.id} label={h.label} title={h.title} on={f.head === h.id} onClick={() => x.change({ head: h.id })} />
              ))}
            </span>
          </FeatureRow>
        </>
      )}
      <FeatureCheck label="Through all" title="Go right through the body" on={f.depth === null} onChange={(on) => x.change({ depth: on ? null : 5 })} />
      {f.depth !== null && <NumberField id="bc-hole-depth" label="Depth" value={f.depth} min={0.1} onCommit={(v) => x.change({ depth: v })} />}
      {lastPoint && (
        <>
          <NumberField label={n > 1 ? `Hole ${n} X` : "Hole X"} value={lastPoint[0]} onCommit={(v) => move(0, v)} />
          <NumberField label={n > 1 ? `Hole ${n} Y` : "Hole Y"} value={lastPoint[1]} onCommit={(v) => move(1, v)} />
        </>
      )}
      <PanelNote>
        {n === 1 ? "1 hole" : `${n} holes`}
        {dia && `, ${dia}`}. X and Y are from the face's centre.
      </PanelNote>
      {n > 1 && (
        <FeatureRow label="Holes">
          <Button label="Remove last" title="Take the last hole out" onClick={() => x.change({ points: f.points.slice(0, -1) })} />
        </FeatureRow>
      )}
      {error && <PanelNote tone="error">{error}</PanelNote>}
    </FeaturePanel>
  );
}
