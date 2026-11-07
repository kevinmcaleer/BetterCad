import { ArmedBar, Button } from "@bettercad/ui";
import type { MeasureResult, Single } from "@bettercad/kernel";
import type { MeasureSession } from "./useMeasure";

/** 2 decimals for millimetres, 1 for degrees, as the brand book's unit rules say. */
export const mmText = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })} mm`;
const mm2 = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })} mm²`;
const mm3 = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("en-GB", { maximumFractionDigits: 1 })} mm³`;
const degText = (n: number) => `${Math.round(n * 10) / 10}°`;
const xyz = (p: [number, number, number]) => p.map((v) => (Math.round(v * 100) / 100).toString()).join(", ");

export interface MeasureRow {
  label: string;
  value: string;
}

function single(s: Single, n: string): MeasureRow[] {
  switch (s.kind) {
    case "vertex":
      return [{ label: `${n}point`, value: `${xyz(s.point)} mm` }];
    case "edge":
      return [
        { label: `${n}length`, value: mmText(s.length) },
        ...(s.circle
          ? [
              { label: `${n}diameter`, value: mmText(s.circle.radius * 2) },
              { label: `${n}radius`, value: mmText(s.circle.radius) },
              { label: `${n}centre`, value: `${xyz(s.circle.centre)} mm` },
            ]
          : []),
      ];
    case "face":
      return [
        { label: `${n}area`, value: mm2(s.area) },
        { label: `${n}perimeter`, value: mmText(s.perimeter) },
        ...(s.circle ? [{ label: `${n}diameter`, value: mmText(s.circle.radius * 2) }] : []),
        ...(s.normal ? [{ label: `${n}normal`, value: xyz(s.normal) }] : []),
      ];
    case "body": {
      const { min, max } = s.bbox;
      return [
        { label: `${n}volume`, value: mm3(s.volume) },
        { label: `${n}surface area`, value: mm2(s.area) },
        { label: `${n}size`, value: `${[0, 1, 2].map((i) => Math.round((max[i]! - min[i]!) * 100) / 100).join(" × ")} mm` },
      ];
    }
  }
}

/** Every value worth showing for a measurement, in reading order. */
export function measureRows(r: MeasureResult): MeasureRow[] {
  const p = r.pair;
  if (!p) return r.items[0] ? single(r.items[0], "").map((x) => ({ ...x, label: x.label[0]!.toUpperCase() + x.label.slice(1) })) : [];
  return [
    { label: "Distance", value: mmText(p.distance) },
    ...(p.angle !== undefined ? [{ label: "Angle", value: degText(p.angle) }] : []),
    ...(p.centres !== undefined ? [{ label: "Centre to centre", value: mmText(p.centres) }] : []),
    { label: "ΔX", value: mmText(Math.abs(p.delta[0])) },
    { label: "ΔY", value: mmText(Math.abs(p.delta[1])) },
    { label: "ΔZ", value: mmText(Math.abs(p.delta[2])) },
  ];
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

/** The strip for Measure: each value with a Copy button, Show components, and Done. */
export function MeasureBar({ m, onDone }: { m: MeasureSession; onDone: () => void }) {
  const rows = m.result ? measureRows(m.result) : [];
  return (
    <ArmedBar title="Measure" icon="ruler">
      {!rows.length && !m.error && <span className="bc-armed-note">{m.help}</span>}
      {rows.length > 0 && (
        <dl className="bc-measure" aria-label="Measurement">
          {rows.map((r) => (
            <div key={r.label} className="bc-measure-row">
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
              <Button size="dense" icon="copy" title={`Copy ${r.label.toLowerCase()}`} onClick={() => copy(r.value)} />
            </div>
          ))}
        </dl>
      )}
      {m.error && (
        <span className="bc-armed-note bc-armed-error" role="alert">
          {m.error}
        </span>
      )}
      {m.result?.pair && (
        <Button label="Show components" title="Draw the X, Y and Z parts of the distance" on={m.components} onClick={() => m.setComponents(!m.components)} />
      )}
      <Button kind="done" label="Done" title="Put the tool down" shortcut="Esc" onClick={onDone} />
    </ArmedBar>
  );
}
