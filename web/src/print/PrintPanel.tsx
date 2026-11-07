import { useState } from "react";
import { Banner, Button, ESC, Fields, NumberField, useEscape } from "@bettercad/ui";
import {
  DEFAULT_INFILL,
  GAP_FITS,
  MATERIALS,
  fitGap,
  gapsFromCoupon,
  matchesProfile,
  type PrinterProfile,
  PRINTERS,
  formatWeight,
  materialOf,
  orientationFacts,
  type CheckArea,
  type Orientation,
  type Printer,
  type PrintSettings,
} from "../state/document";
import { FIT_CALIBRATION_GAPS } from "@bettercad/kernel/samples";

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
  /** Ways to lay the model down (#103), best scored first; null while they're worked out. */
  suggestions: Suggestion[] | null;
  onSuggestion: (s: Suggestion) => void;
  /** What printed holes add, mm (#104), and how many hole steps were made at another offset. */
  holeOffset: number;
  staleHoles: number;
  onUpdateHoles: () => void;
  /** Opens the hole calibration coupon. */
  onCalibrate: () => void;
  /** Opens the fit calibration coupon (#182). */
  onCalibrateFits: () => void;
  /** Saved printers (#180) and what to do with them. */
  profiles: PrinterProfile[];
  onPickProfile: (id: string | null) => void;
  onSaveProfile: (name: string) => void;
  onUpdateProfile: () => void;
  onDeleteProfile: () => void;
  /** Fitted cuts made at another gap, and the update that brings them to the gaps set now. */
  staleFits: number;
  onUpdateFits: () => void;
}

/** An orientation suggestion with its thumbnail (a PNG data URL, or null where the view can't draw one). */
export type Suggestion = Orientation & { picture: string | null };

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
      <ProfilePicker
        settings={p.settings}
        profiles={p.profiles}
        onPick={p.onPickProfile}
        onSave={p.onSaveProfile}
        onUpdate={p.onUpdateProfile}
        onDelete={p.onDeleteProfile}
      />
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

      <h2 className="bc-panel-title">Orientation</h2>
      {!p.hasModel ? (
        <p className="bc-note">Add a shape to see which way down it prints best.</p>
      ) : !p.suggestions ? (
        <p className="bc-note" role="status">
          Working out suggestions…
        </p>
      ) : (
        <>
          <ul className="bc-orient" aria-label="Suggestions">
            {p.suggestions.map((o, i) => {
              const facts = orientationFacts(o);
              return (
                <li key={i}>
                  <button
                    type="button"
                    className={o.current ? "bc-orient-pick bc-orient-current" : "bc-orient-pick"}
                    aria-pressed={o.current}
                    aria-label={`${o.current ? "As it lies now" : `Suggestion ${i + 1}`}: ${facts}`}
                    title={facts}
                    onClick={() => p.onSuggestion(o)}
                  >
                    {o.picture ? <img src={o.picture} alt="" width={96} height={64} /> : <span className="bc-orient-blank" />}
                    <span>{o.current ? "As it lies" : `Suggestion ${i + 1}`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="bc-note bc-micro">Suggestions weigh how much touches the bed, how much overhangs and how tall it stands. Pick one to turn the model.</p>
        </>
      )}

      <h2 className="bc-panel-title">Holes</h2>
      <Fields>
        <NumberField
          label="Hole offset"
          value={p.holeOffset}
          min={0}
          max={1}
          step={0.05}
          unit="mm"
          onCommit={(v) => p.onChange({ holeOffset: Math.round(Math.max(0, Math.min(1, v)) * 100) / 100 })}
        />
      </Fields>
      <p className="bc-note">Printed holes come out small, so a printed clearance adds this to the screw's size. Most printers need 0.2 to 0.6 mm.</p>
      {p.staleHoles > 0 && (
        <Button
          variant="secondary"
          size="wide"
          icon="hole"
          label={p.staleHoles === 1 ? "Update 1 hole" : `Update ${p.staleHoles} holes`}
          title={`Resize printed holes made at another offset to add ${p.holeOffset} mm`}
          onClick={p.onUpdateHoles}
        />
      )}
      <Button
        size="wide"
        icon="ruler"
        label="Calibrate"
        title="Open a test plate with M2 to M6 holes at offsets from 0.2 to 0.6 mm. Print it and see which ones a screw slides through."
        onClick={p.onCalibrate}
      />

      <FitSection settings={p.settings} onChange={p.onChange} onCalibrate={p.onCalibrateFits} stale={p.staleFits} onUpdate={p.onUpdateFits} />

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

const slotName = (i: number) => `Slot ${i + 1}, ${FIT_CALIBRATION_GAPS[i]} mm`;

/** Fits (#181, #182): the gap each side for press, sliding and loose fits, typed or read off the fit coupon. */
function FitSection({
  settings,
  onChange,
  onCalibrate,
  stale,
  onUpdate,
}: {
  settings: PrintSettings;
  onChange: (c: Partial<PrintSettings>) => void;
  onCalibrate: () => void;
  stale: number;
  onUpdate: () => void;
}) {
  const [pressed, setPressed] = useState<number | null>(null);
  const [slid, setSlid] = useState<number | null>(null);
  const set = (id: (typeof GAP_FITS)[number]["id"], v: number) =>
    onChange({ fits: { ...settings.fits, [id]: Math.round(Math.max(0, Math.min(2, v)) * 100) / 100 } });
  const slotSelect = (id: string, label: string, value: number | null, pick: (i: number) => void) => (
    <>
      <label className="bc-field-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="bc-select bc-print-select" value={value ?? ""} onChange={(e) => pick(Number(e.target.value))}>
        <option value="" disabled>
          Pick a slot
        </option>
        {FIT_CALIBRATION_GAPS.map((_, i) => (
          <option key={i} value={i}>
            {slotName(i)}
          </option>
        ))}
      </select>
    </>
  );
  return (
    <>
      <h2 className="bc-panel-title">Fits</h2>
      <Fields>
        {GAP_FITS.map((f) => (
          <NumberField
            key={f.id}
            label={f.name.replace(" fit", "")}
            value={fitGap(f.id, settings.fits)}
            min={0}
            max={2}
            step={0.05}
            precision={2}
            unit="mm"
            onCommit={(v) => set(f.id, v)}
          />
        ))}
      </Fields>
      <p className="bc-note">The gap on each side when one printed part goes into another. A sliding fit leaves a 10 mm peg a 10.5 mm pocket.</p>
      {stale > 0 && (
        <Button
          variant="secondary"
          size="wide"
          icon="combine"
          label={stale === 1 ? "Update 1 fitted cut" : `Update ${stale} fitted cuts`}
          title="Resize cuts made with other gaps to the fits set now"
          onClick={onUpdate}
        />
      )}
      <Button
        size="wide"
        icon="ruler"
        label="Calibrate fits"
        title="Open a test plate with a peg and six slots from 0.05 to 0.4 mm each side. Print it and try the peg in each slot."
        onClick={onCalibrate}
      />
      <details className="bc-print-details">
        <summary>I've printed the fit coupon</summary>
        {slotSelect("bc-fit-pressed", "Which slot did the peg press into?", pressed, setPressed)}
        {slotSelect("bc-fit-slid", "Which slot did it slide freely in?", slid, setSlid)}
        <Button
          variant="secondary"
          size="wide"
          label="Set fits"
          title="Set press and sliding from the slots, and loose 0.15 mm wider than sliding"
          disabled={pressed === null || slid === null}
          onClick={() => {
            if (pressed === null || slid === null) return;
            onChange({ fits: gapsFromCoupon(FIT_CALIBRATION_GAPS[pressed]!, FIT_CALIBRATION_GAPS[slid]!) });
          }}
        />
      </details>
    </>
  );
}

/** Saved printers (#180): pick one to copy its bed, hole offset and fits into this model, or save this model's as one. */
function ProfilePicker({
  settings,
  profiles,
  onPick,
  onSave,
  onUpdate,
  onDelete,
}: {
  settings: PrintSettings;
  profiles: PrinterProfile[];
  onPick: (id: string | null) => void;
  onSave: (name: string) => void;
  onUpdate: () => void;
  onDelete: () => void;
}) {
  const [naming, setNaming] = useState<string | null>(null);
  useEscape(naming !== null, () => setNaming(null), ESC.panel);
  const current = profiles.find((x) => x.id === settings.profile) ?? null;
  const changed = current !== null && !matchesProfile(settings, current);
  const finish = () => {
    const name = naming?.trim();
    if (name) onSave(name);
    setNaming(null);
  };
  return (
    <>
      <label className="bc-field-label" htmlFor="bc-profile">
        My printers
      </label>
      <select id="bc-profile" className="bc-select bc-print-select" value={current?.id ?? ""} onChange={(e) => onPick(e.target.value || null)}>
        <option value="">{profiles.length ? "None: set for this model only" : "No saved printers yet"}</option>
        {profiles.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      {changed && (
        <>
          <p className="bc-note">This model's settings differ from {current.name}.</p>
          <Button variant="secondary" size="wide" label={`Save to ${current.name}`} title="Keep these settings in the saved printer" onClick={onUpdate} />
        </>
      )}
      {naming === null ? (
        <span className="bc-print-row">
          <Button size="wide" label="Save as a printer" title="Keep this bed, hole offset and fits to use in other models" onClick={() => setNaming("")} />
          {current && <Button label="Delete" title={`Delete ${current.name} from your printers`} onClick={onDelete} />}
        </span>
      ) : (
        <form
          className="bc-print-name"
          onSubmit={(e) => {
            e.preventDefault();
            finish();
          }}
        >
          <label className="bc-field-label" htmlFor="bc-profile-name">
            Printer name
          </label>
          <input id="bc-profile-name" className="bc-text" autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} placeholder="My Bambu A1" />
          <span className="bc-print-row">
            <Button kind="cancel" label="Cancel" title="Don't save" shortcut="Esc" onClick={() => setNaming(null)} />
            <Button kind="done" label="Save" title="Save this printer" disabled={!naming.trim()} onClick={finish} />
          </span>
        </form>
      )}
    </>
  );
}
