import { Banner, Button, Fields, NumberField } from "@bettercad/ui";
import { DEFAULT_INFILL, MATERIALS, PRINTERS, formatWeight, materialOf, type Printer, type PrintSettings } from "../state/document";

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
        className="bc-select"
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

      <h2 className="bc-panel-title">Material</h2>
      <label className="bc-field-label" htmlFor="bc-material">
        Material
      </label>
      <select id="bc-material" className="bc-select" value={material.id} onChange={(e) => p.onChange({ material: e.target.value })}>
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
