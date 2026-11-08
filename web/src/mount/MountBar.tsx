import type { KeyboardEvent } from "react";
import { ArmedBar, Button, MenuButton, NumberField, type MenuEntry } from "@bettercad/ui";
import { HOLE_PATTERNS } from "@bettercad/kernel/catalogue";
import { SCREWS, circlePattern, rectPattern, screw, type MountFeature } from "../state/document";
import { middle, type MountSession } from "./useMount";

const HORNS: { id: MountFeature["horn"]; label: string; title: string }[] = [
  { id: "single", label: "Single", title: "A one-arm horn: one screw hole" },
  { id: "double", label: "Double", title: "A two-arm horn: holes both ways" },
  { id: "cross", label: "Cross", title: "A four-arm horn: holes on all four arms" },
];

const round = (v: number) => Math.round(v * 100) / 100;

/** The strip for Mount (#189): standoffs or a horn mount, its pattern and sizes, Cancel and Done. */
export function MountBar({ x, error, onCancel }: { x: MountSession; error?: string; onCancel: () => void }) {
  const f = x.feature;
  if (!f) {
    return (
      <ArmedBar title="Mount" icon="hole">
        <span className="bc-armed-note">{x.help}</span>
        <Button kind="cancel" label="Cancel" title="Put the tool down" shortcut="Esc" onClick={onCancel} />
      </ArmedBar>
    );
  }
  const onFieldKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") x.done();
  };
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
    <ArmedBar title={horn ? "Horn mount" : "Standoffs"} icon="hole">
      <span role="group" aria-label="Mount" className="bc-segmented">
        <Button label="Standoffs" title="Posts to screw a board to" on={!horn} onClick={() => x.change({ kind: "standoffs" })} />
        <Button label="Horn mount" title="Bolt a servo horn to the part" on={horn} onClick={() => x.change({ kind: "horn", points: [f.points[0]!] })} />
      </span>
      <MenuButton label="Screw" entries={sizes} trigger={(p) => <Button {...p} label={f.size} title="The screw size" />} />
      {horn ? (
        <span role="group" aria-label="Horn" className="bc-segmented">
          {HORNS.map((h) => (
            <Button key={h.id} label={h.label} title={h.title} on={f.horn === h.id} onClick={() => x.change({ horn: h.id })} />
          ))}
        </span>
      ) : (
        <>
          <MenuButton
            label="Pattern"
            entries={patterns}
            trigger={(p) => <Button {...p} label="Pattern" title="Put the standoffs on a board's holes, or a shape" />}
          />
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
        </>
      )}
      <span className="bc-sk-fields" onKeyDown={onFieldKey}>
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
      </span>
      <span className="bc-armed-note">
        {horn ? "Measure your horn: these suit a micro servo's." : n === 1 ? "1 standoff." : `${n} standoffs.`} X and Y are from the face's centre.
      </span>
      {!horn && n > 1 && <Button label="Remove last" title="Take the last standoff out" onClick={() => x.change({ points: f.points.slice(0, -1) })} />}
      {error && (
        <span className="bc-armed-note bc-armed-error" role="alert">
          {error}
        </span>
      )}
      <Button kind="cancel" label="Cancel" title="Take the mount back" shortcut="Esc" onClick={x.cancel} />
      <Button kind="done" label="Done" title="Keep the mount" shortcut="Enter" onClick={x.done} />
    </ArmedBar>
  );
}
