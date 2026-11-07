import { Banner, Button, Fields, NumberField } from "@bettercad/ui";
import { DEFAULT_INFILL, MATERIALS, PRINTERS, formatWeight, materialOf, type CheckArea, type Printer, type PrintSettings } from "../state/document";

/**
 * The Print panel (#100, #105): the printer the model is for, its bed in the view, whether the model fits, and the
 * material and infill the weight estimate uses. The choices are kept in the document.
 */
export interface PrintPanelProps {
  settings: PrintSettings;
  printer: Printer;
  onChange: (change: Partial<PrintSettings>) => void;
  showBed: boolean;
  onShowBed: (on: boolean) => void;
  /** Why the model doesn't fit, or null when it does (or there's nothing to print). */
  fitProblem: string | null;
  hasModel: boolean;
  onCentre: () => void;
  /** Grams for the whole model at the chosen material and infill, when the kernel has measured it. */
  weight: number | null;
  /** The print check on show (#101, #102): one at a time. */
  check: PrintCheck;
  onCheck: (c: PrintCheck) => void;
  overhangAngle: number;
  onOverhangAngle: (deg: number) => void;
  thinWall: number;
  onThinWall: (mm: number) => void;
  /** The check's areas, worst first; null while it runs. */
  areas: CheckArea[] | null;
  onShowArea: (a: CheckArea) => void;
}

export type PrintCheck = "none" | "overhang" | "thin";

const mm2 = (n: number) => `${Math.round(n).toLocaleString("en-GB")} mm²`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Needs support: 2 areas, 340 mm²" or "3 thin areas, thinnest 0.45 mm". */
export function checkSummary(check: PrintCheck, areas: CheckArea[] | null, limit: number): string {
  if (check === "none") return "";
  if (!areas) return "Checking…";
  if (check === "overhang") {
    if (!areas.length) return `Nothing overhangs more than ${limit}°, so it needs no support.`;
    return `Needs support: ${plural(areas.length, "area")}, ${mm2(areas.reduce((a, x) => a + x.area, 0))}`;
  }
  if (!areas.length) return `No walls thinner than ${limit} mm.`;
  const min = Math.min(...areas.map((a) => a.min ?? Infinity));
  return `${plural(areas.length, "thin area")}, thinnest ${Math.round(min * 100) / 100} mm`;
}

export function PrintPanel(p: PrintPanelProps) {
  const custom = p.settings.printer === "custom";
  const size = p.settings.custom ?? { x: 200, y: 200, z: 200 };
  const material = materialOf(p.settings.material);
  return (
    <>
      <h2 className="bc-panel-title">Printer</h2>
      <label className="bc-field-label" htmlFor="bc-printer">
        Printer
      </label>
      <select
        id="bc-printer"
        className="bc-select bc-print-select"
        value={custom ? "custom" : p.printer.id}
        onChange={(e) => p.onChange(e.target.value === "custom" ? { printer: "custom", custom: size } : { printer: e.target.value })}
      >
        {PRINTERS.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name} ({x.x} × {x.y} × {x.z} mm)
          </option>
        ))}
        <option value="custom">Custom</option>
      </select>
      {custom && (
        <Fields>
          {(["x", "y", "z"] as const).map((a) => (
            <NumberField
              key={a}
              label={a.toUpperCase()}
              value={size[a]}
              min={10}
              unit="mm"
              onCommit={(v) => p.onChange({ printer: "custom", custom: { ...size, [a]: v } })}
            />
          ))}
        </Fields>
      )}
      <label className="bc-check">
        <input type="checkbox" checked={p.showBed} onChange={(e) => p.onShowBed(e.target.checked)} />
        <span>Show the bed</span>
      </label>
      {p.hasModel &&
        (p.fitProblem ? (
          <Banner tone="warn">{p.fitProblem}</Banner>
        ) : (
          <p className="bc-note" role="status">
            The model fits {custom ? "your printer" : `a ${p.printer.name}`}.
          </p>
        ))}
      <Button
        variant="secondary"
        size="wide"
        icon="frame"
        label="Centre on bed"
        title="Move the model to the middle of the bed, resting on it"
        disabled={!p.hasModel}
        onClick={p.onCentre}
      />
      <p className="bc-note">
        {p.printer.origin === "corner"
          ? "This printer's slicer puts 0, 0 at the front-left corner, marked with a cross."
          : "This printer's slicer puts 0, 0 in the middle of the bed."}
      </p>

      <h2 className="bc-panel-title">Checks</h2>
      <span role="group" aria-label="Check" className="bc-segmented">
        <Button label="Off" on={p.check === "none"} onClick={() => p.onCheck("none")} />
        <Button label="Overhangs" on={p.check === "overhang"} onClick={() => p.onCheck("overhang")} />
        <Button label="Thin walls" on={p.check === "thin"} onClick={() => p.onCheck("thin")} />
      </span>
      {p.check === "overhang" && (
        <Fields>
          <NumberField
            label="Steepest"
            value={p.overhangAngle}
            min={30}
            max={70}
            step={1}
            precision={0}
            unit="°"
            onCommit={(v) => p.onOverhangAngle(Math.max(30, Math.min(70, v)))}
          />
        </Fields>
      )}
      {p.check === "thin" && (
        <Fields>
          <NumberField
            label="Thinnest"
            value={p.thinWall}
            min={0.1}
            max={50}
            step={0.1}
            unit="mm"
            onCommit={(v) => p.onThinWall(Math.max(0.1, Math.min(50, v)))}
          />
        </Fields>
      )}
      {p.check !== "none" && (
        <>
          <p className="bc-note" role="status">
            {checkSummary(p.check, p.areas, p.check === "overhang" ? p.overhangAngle : p.thinWall)}
          </p>
          {p.areas && p.areas.length > 0 && (
            <ul className="bc-check-areas" aria-label={p.check === "overhang" ? "Areas that need support" : "Thin areas"}>
              {p.areas.slice(0, 12).map((a, i) => (
                <li key={i}>
                  <span>{p.check === "thin" && a.min !== undefined ? `${Math.round(a.min * 100) / 100} mm` : mm2(a.area)}</span>
                  <Button size="dense" icon="frame" label="Show" title={`Show area ${i + 1}`} onClick={() => p.onShowArea(a)} />
                </li>
              ))}
            </ul>
          )}
          <p className="bc-note bc-micro">
            {p.check === "overhang"
              ? "Downward faces steeper than this need support. Short bridges often print fine without it."
              : "Thinner walls than about two nozzle widths may not print. This samples the surface, so it can miss a wall."}
          </p>
        </>
      )}

      <h2 className="bc-panel-title">Material</h2>
      <label className="bc-field-label" htmlFor="bc-material">
        Material
      </label>
      <select id="bc-material" className="bc-select bc-print-select" value={material.id} onChange={(e) => p.onChange({ material: e.target.value })}>
        {MATERIALS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} ({m.density} g/cm³)
          </option>
        ))}
      </select>
      <Fields>
        <NumberField
          label="Infill"
          value={p.settings.infill ?? DEFAULT_INFILL}
          min={0}
          max={100}
          step={5}
          precision={0}
          unit="%"
          onCommit={(v) => p.onChange({ infill: Math.round(Math.max(0, Math.min(100, v))) })}
        />
      </Fields>
      {p.weight !== null && (
        <p className="bc-note" role="status">
          This model weighs {formatWeight(p.weight)} in {material.name} at {p.settings.infill ?? DEFAULT_INFILL}% infill.
        </p>
      )}
      <p className="bc-note bc-micro">An estimate from the volume and surface, usually within 20% of your slicer.</p>
    </>
  );
}
