import { Button, FeaturePanel, FeatureRow, MenuButton, NumberField, PanelNote, type MenuEntry } from "@bettercad/ui";
import { HOLE_PATTERNS } from "@bettercad/kernel/catalogue";
import { SCREWS, circlePattern, rectPattern, screw, type MountFeature } from "../state/document";
import { middle, type MountSession } from "./useMount";

const HORNS: { id: MountFeature["horn"]; label: string; title: string }[] = [
  { id: "single", label: "Single", title: "A one-arm horn: one screw hole" },
  { id: "double", label: "Double", title: "A two-arm horn: holes both ways" },
  { id: "cross", label: "Cross", title: "A four-arm horn: holes on all four arms" },
];

const round = (v: number) => Math.round(v * 100) / 100;

/** The panel for Mount (#189): standoffs or a horn mount, its pattern and sizes, Cancel and OK. */
export function MountBar({ x, error, onCancel }: { x: MountSession; error?: string; onCancel: () => void }) {
  const f = x.feature;
  if (!f) {
    return (
      <FeaturePanel title="Mount" icon="hole" cancel={{ title: "Put the tool down", onClick: onCancel }}>
        <PanelNote>{x.help}</PanelNote>
      </FeaturePanel>
    );
  }
  const s = screw(f.size);
  const sizes: MenuEntry[] = SCREWS.filter((t) => t.system === "metric").map((t) => ({
    id: t.id,
    label: t.label,
    checked: f.size === t.id,
    onSelect: () => x.change({ size: t.id }),
  }));
  const at = middle(f.points);
  const centred = (pts: [number, number][]) => pts.map((p) => [round(at[0] + p[0]), round(at[1] + p[1])] as [number, number]);
  const patterns: MenuEntry[] = [
    { id: "one", label: "One standoff", onSelect: () => x.change({ points: centred([[0, 0]]) }) },
    { id: "rect", label: "Rectangle, 40 × 30 mm", onSelect: () => x.change({ points: centred(rectPattern(40, 30)) }) },
    { id: "circle", label: "Circle of 4, 30 mm", onSelect: () => x.change({ points: centred(circlePattern(4, 30)) }) },
    { kind: "title", id: "parts", label: "Parts" },
    ...HOLE_PATTERNS.map((p) => ({ id: p.id, label: p.label, onSelect: () => x.change({ points: centred(p.points), size: p.screw }) })),
  ];
  const n = f.points.length;
  const lastPoint = f.points[n - 1];
  const move = (axis: 0 | 1, v: number) =>
    x.change({ points: f.points.map((p, i) => (i === n - 1 ? ((axis ? [p[0], v] : [v, p[1]]) as [number, number]) : p)) });
  const horn = f.kind === "horn";
  return (
    <FeaturePanel
      title={horn ? "Horn mount" : "Standoffs"}
      icon="hole"
      onFieldEnter={() => x.done()}
      cancel={{ title: "Take the mount back", onClick: x.cancel }}
      ok={{ title: "Keep the mount", onClick: x.done }}
    >
      <FeatureRow label="Kind">
        <span role="group" aria-label="Mount" className="bc-segmented">
          <Button label="Standoffs" title="Posts to screw a board to" on={!horn} onClick={() => x.change({ kind: "standoffs" })} />
          <Button label="Horn mount" title="Bolt a servo horn to the part" on={horn} onClick={() => x.change({ kind: "horn", points: [f.points[0]!] })} />
        </span>
      </FeatureRow>
      <FeatureRow label="Screw">
        <MenuButton label="Screw" entries={sizes} trigger={(p) => <Button {...p} label={f.size} title="The screw size" />} />
      </FeatureRow>
      {horn ? (
        <FeatureRow label="Horn">
          <span role="group" aria-label="Horn" className="bc-segmented">
            {HORNS.map((h) => (
              <Button key={h.id} label={h.label} title={h.title} on={f.horn === h.id} onClick={() => x.change({ horn: h.id })} />
            ))}
          </span>
        </FeatureRow>
      ) : (
        <>
          <FeatureRow label="Layout">
            <MenuButton
              label="Pattern"
              entries={patterns}
              trigger={(p) => <Button {...p} label="Pattern" title="Put the standoffs on a board's holes, or a shape" />}
            />
          </FeatureRow>
          <FeatureRow label="Hole">
            <span role="group" aria-label="Hole" className="bc-segmented">
              <Button
                label="Through"
                title="A clearance hole right through, for a screw and nut"
                on={f.hole === "through"}
                onClick={() => x.change({ hole: "through" })}
              />
              <Button
                label="Insert"
                title={s?.insert ? `A hole for a heat-set insert, ${s.insert.diameter} mm` : `No heat-set insert for ${f.size}`}
                on={f.hole === "insert"}
                onClick={() => x.change({ hole: "insert" })}
              />
            </span>
          </FeatureRow>
        </>
      )}
      {horn ? (
        <>
          <NumberField label="Hub" unit="mm" value={f.hub} min={0.1} onCommit={(v) => x.change({ hub: v })} />
          <NumberField label="Recess" unit="mm" value={f.recess} min={0.1} onCommit={(v) => x.change({ recess: v })} />
          <NumberField label="Arm hole" unit="mm" value={f.arm} min={0.1} onCommit={(v) => x.change({ arm: v })} />
          <NumberField label="Screwdriver hole" unit="mm" value={f.access} min={0} onCommit={(v) => x.change({ access: v })} />
        </>
      ) : (
        <>
          <NumberField label="Height" unit="mm" value={f.height} min={0.1} onCommit={(v) => x.change({ height: v })} />
          <NumberField label="Width" unit="mm" value={f.outer} min={0.1} onCommit={(v) => x.change({ outer: v })} />
        </>
      )}
      {lastPoint && (
        <>
          <NumberField label={horn ? "Centre X" : n > 1 ? `Standoff ${n} X` : "Standoff X"} value={lastPoint[0]} onCommit={(v) => move(0, v)} />
          <NumberField label={horn ? "Centre Y" : n > 1 ? `Standoff ${n} Y` : "Standoff Y"} value={lastPoint[1]} onCommit={(v) => move(1, v)} />
        </>
      )}
      <PanelNote>
        {horn ? "Measure your horn: these suit a micro servo's." : n === 1 ? "1 standoff." : `${n} standoffs.`} X and Y are from the face's centre.
      </PanelNote>
      {!horn && n > 1 && (
        <FeatureRow label="Standoffs">
          <Button label="Remove last" title="Take the last standoff out" onClick={() => x.change({ points: f.points.slice(0, -1) })} />
        </FeatureRow>
      )}
      {error && <PanelNote tone="error">{error}</PanelNote>}
    </FeaturePanel>
  );
}
