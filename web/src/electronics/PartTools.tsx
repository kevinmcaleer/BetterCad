import { useId, useMemo, useState } from "react";
import { PIN_TYPES, type ComponentDef, type FootprintDef } from "@bettercad/electronics";
import { importEagleLibraries } from "@bettercad/electronics/eagle/import";
import { importKicad, type Imported } from "@bettercad/electronics/kicad";
import { Button, Dialog, NumberField, cx } from "@bettercad/ui";
import { textOf } from "./fileText";
import { PartPreview } from "./PartPreview";
import { FAMILIES, LICENCES, build, draftFrom, newDraft, type BodyKind, type Draft, type Family, type Sizes } from "./partDraft";

type Tab = "details" | "symbol" | "footprint" | "body";
const TABS: { id: Tab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "symbol", label: "Symbol" },
  { id: "footprint", label: "Footprint" },
  { id: "body", label: "3D body" },
];

/** What the editor opens on: a new part, or a component to change (`id`: one of yours) or to copy. */
export interface EditStart {
  def?: ComponentDef;
  id?: string;
  shelf?: string;
}

export interface PartEditorProps {
  start: EditStart;
  /** Shelves there are already, offered as you type. */
  shelves: string[];
  onSave: (def: ComponentDef, shelf: string, id?: string) => void;
  onCancel: () => void;
}

/**
 * The part editor (#626, #627, #628): a symbol from a pin table, a footprint from a package's sizes, a simple 3D body,
 * and the details that travel with the part. What it makes is checked as you type and saved to your parts.
 */
export function PartEditor({ start, shelves, onSave, onCancel }: PartEditorProps) {
  const [d, setD] = useState<Draft>(() =>
    start.def ? draftFrom(start.def, { ...(start.id ? { id: start.id } : {}), ...(start.shelf ? { shelf: start.shelf } : {}) }) : newDraft(),
  );
  const [tab, setTab] = useState<Tab>("details");
  const ids = useId();
  const set = (patch: Partial<Draft>) => setD((now) => ({ ...now, ...patch }));
  const built = useMemo(() => build(d), [d]);
  const shown: ComponentDef = built.def ?? {
    name: d.name || "Part",
    prefix: d.prefix,
    symbol: built.symbol,
    packages: built.footprint ? [{ footprint: built.footprint }] : [],
  };
  const save = () => built.def && onSave(built.def, d.shelf.trim(), d.id);

  const text = (key: keyof Draft & string, label: string, opts: { placeholder?: string; list?: string } = {}) => (
    <>
      <label className="bc-field-label" htmlFor={`${ids}${key}`}>
        {label}
      </label>
      <input
        id={`${ids}${key}`}
        className="bc-text"
        value={d[key] as string}
        placeholder={opts.placeholder}
        list={opts.list}
        onChange={(e) => set({ [key]: e.target.value } as Partial<Draft>)}
      />
    </>
  );
  const family = FAMILIES.find((f) => f.id === d.family);
  const sizes = (family ? d.sizes[family.id] : {}) as unknown as Record<string, number>;
  const setSize = (key: string, v: number) => family && set({ sizes: { ...d.sizes, [family.id]: { ...d.sizes[family.id], [key]: v } } as Sizes });

  return (
    <Dialog
      open
      modal
      title={d.id ? "Edit part" : "New part"}
      icon="chip"
      className="bc-ec-editor"
      onCancel={onCancel}
      footer={
        <>
          <Button kind="cancel" label="Cancel" onClick={onCancel} />
          <Button variant="primary" label={d.id ? "Save" : "Save to your parts"} disabled={!built.def} onClick={save} />
        </>
      }
    >
      <div className="bc-ec-editor-tabs" role="tablist" aria-label="Part">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${ids}t-${t.id}`}
            aria-selected={tab === t.id}
            className={cx("bc-ec-switch-item", tab === t.id && "bc-on")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="bc-ec-editor-main">
        <div className="bc-ec-editor-fields" role="tabpanel" aria-labelledby={`${ids}t-${tab}`}>
          {tab === "details" && (
            <>
              {text("name", "Name", { placeholder: "TXS0102 level shifter" })}
              <div className="bc-ec-editor-pair">
                <div>{text("prefix", "Reference letter", { placeholder: "U" })}</div>
                <div>{text("value", "Starts as", { placeholder: "10 kΩ" })}</div>
              </div>
              {text("description", "What it is")}
              {text("keywords", "Words to find it by", { placeholder: "i2c, level shifter" })}
              {text("shelf", "Shelf", { placeholder: "Your parts", list: `${ids}shelves` })}
              <datalist id={`${ids}shelves`}>
                {shelves.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              {text("datasheet", "Datasheet link", { placeholder: "https://" })}
              <div className="bc-ec-editor-pair">
                <div>{text("manufacturer", "Maker")}</div>
                <div>{text("mpn", "Maker's part number")}</div>
              </div>
              {text("lcsc", "LCSC part number", { placeholder: "C25804" })}
              <label className="bc-field-label" htmlFor={`${ids}licence`}>
                Licence
              </label>
              <select id={`${ids}licence`} className="bc-select" value={d.licence} onChange={(e) => set({ licence: e.target.value })}>
                {[...new Set([d.licence, ...LICENCES])].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
              {text("credit", "Credit", { placeholder: "You" })}
              <p className="bc-note">The licence and credit travel with the part when you share or export your library.</p>
            </>
          )}
          {tab === "symbol" && (
            <>
              <label className="bc-field-label" htmlFor={`${ids}pins`}>
                Pins
              </label>
              <textarea
                id={`${ids}pins`}
                className="bc-text bc-ec-pins"
                rows={10}
                spellCheck={false}
                value={d.pins}
                onChange={(e) => set({ pins: e.target.value })}
              />
              <p className="bc-note">
                One pin a line: number, name, what it does, and a side if you want one. Paste from a spreadsheet or a datasheet. It understands{" "}
                {PIN_TYPES.filter((t) => t.id !== "unspecified")
                  .map((t) => t.label.toLowerCase())
                  .join(", ")}
                , and left, right, top, bottom.
              </p>
              {d.base && (
                <label className="bc-check">
                  <input type="checkbox" checked={d.box} onChange={(e) => set({ box: e.target.checked })} />
                  Draw as a box from the pin list
                </label>
              )}
              {d.base && !d.box && <p className="bc-note">The drawing is kept as it came. You can rename pins and change what they do.</p>}
            </>
          )}
          {tab === "footprint" && (
            <>
              <label className="bc-field-label" htmlFor={`${ids}family`}>
                Package
              </label>
              <select id={`${ids}family`} className="bc-select" value={d.family} onChange={(e) => set({ family: e.target.value as Family })}>
                {d.base && d.base.packages.length > 0 && <option value="keep">Keep its footprints ({d.base.packages.length})</option>}
                {FAMILIES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              {family ? (
                <>
                  <p className="bc-note">{family.hint} Take the sizes from the datasheet's land pattern.</p>
                  <div className="bc-ec-editor-sizes">
                    {family.fields.map((f) => (
                      <NumberField
                        key={`${family.id}-${f.key}`}
                        label={f.label}
                        unit={f.whole ? "none" : "mm"}
                        value={sizes[f.key] ?? 0}
                        min={f.min}
                        {...(f.max ? { max: f.max } : {})}
                        step={f.whole ? 1 : 0.05}
                        precision={f.whole ? 0 : 3}
                        onCommit={(v) => setSize(f.key, f.whole ? Math.round(v) : v)}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <p className="bc-note">
                  The footprints are kept as they came: {d.base?.packages.map((p) => p.footprint.name).join(", ")}. Pick a package to make a new one from sizes.
                </p>
              )}
            </>
          )}
          {tab === "body" && (
            <>
              <label className="bc-field-label" htmlFor={`${ids}body`}>
                Body
              </label>
              <select
                id={`${ids}body`}
                className="bc-select"
                value={d.family === "keep" ? "keep" : d.body}
                disabled={d.family === "keep"}
                onChange={(e) => set({ body: e.target.value as BodyKind })}
              >
                {d.family === "keep" && <option value="keep">Kept with its footprints</option>}
                <option value="auto">Sized from the footprint</option>
                <option value="box">A box</option>
                <option value="cylinder">A cylinder</option>
                <option value="none">None</option>
              </select>
              {d.family !== "keep" && (d.body === "box" || d.body === "cylinder") && (
                <div className="bc-ec-editor-sizes">
                  <NumberField
                    label={d.body === "box" ? "Width" : "Diameter"}
                    unit="mm"
                    value={d.bodySize.w}
                    min={0.1}
                    step={0.1}
                    onCommit={(w) => set({ bodySize: { ...d.bodySize, w } })}
                  />
                  {d.body === "box" && (
                    <NumberField label="Length" unit="mm" value={d.bodySize.l} min={0.1} step={0.1} onCommit={(l) => set({ bodySize: { ...d.bodySize, l } })} />
                  )}
                  <NumberField label="Height" unit="mm" value={d.bodySize.h} min={0.1} step={0.1} onCommit={(h) => set({ bodySize: { ...d.bodySize, h } })} />
                </div>
              )}
              <p className="bc-note">The body is what the 3D board shows for this part. It sits on the middle of the footprint.</p>
            </>
          )}
        </div>
        <div className="bc-ec-editor-side">
          <PartPreview def={shown} pkg={0} />
          <ul className="bc-ec-editor-checks" aria-label="Checks">
            {built.problems.map((p) => (
              <li key={p} className="bc-ec-blocked">
                {p}
              </li>
            ))}
            {built.notes.map((n) => (
              <li key={n} className="bc-ec-warned">
                {n}
              </li>
            ))}
            {built.problems.length + built.notes.length === 0 && <li>Every pin has a pad. Ready to save.</li>}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}

const IMPORT_LICENCES = [
  "Not set",
  "CC-BY-SA 4.0 with the KiCad libraries exception",
  "CC-BY-SA 4.0",
  "CC-BY 4.0",
  "CC0 1.0 (no rights kept)",
  "MIT",
  "Apache 2.0",
  "All rights reserved",
];

export interface ImportPartsProps {
  /** A footprint by its KiCad name, for symbols whose footprint is not among the files. */
  known?: (name: string) => FootprintDef | undefined;
  onAdd: (parts: ComponentDef[]) => void;
  onCancel: () => void;
}

/** Import parts (#623, #665): pick KiCad `.kicad_sym` and `.kicad_mod` files or Eagle `.lbr` libraries, see what was found and left out, then add. */
export function ImportParts({ known, onAdd, onCancel }: ImportPartsProps) {
  const [files, setFiles] = useState<{ name: string; text: string }[]>([]);
  const [licence, setLicence] = useState(IMPORT_LICENCES[0]!);
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const ids = useId();
  const got: Imported | null = useMemo(() => {
    if (!files.length) return null;
    const source = { licence, ...(from.trim() ? { library: from.trim() } : {}) };
    // Eagle's libraries are whole in one file; KiCad's symbols and footprints are paired across files.
    const eagle = files.filter((f) => /\.lbr$/i.test(f.name) || /<eagle[\s>]/.test(f.text.slice(0, 4000)));
    const kicad = files.filter((f) => !eagle.includes(f));
    const a = kicad.length ? importKicad(kicad, source, known) : null;
    const b = eagle.length ? importEagleLibraries(eagle, source) : null;
    return {
      parts: [...(a?.parts ?? []), ...(b?.parts ?? [])],
      found: { symbols: (a?.found.symbols ?? 0) + (b?.found.symbols ?? 0), footprints: (a?.found.footprints ?? 0) + (b?.found.footprints ?? 0) },
      notes: [...(a?.notes ?? []), ...(b?.notes ?? [])],
    };
  }, [files, licence, from, known]);
  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    const read = await Promise.all(Array.from(list).map(async (f) => ({ name: f.name, text: await textOf(f) })));
    setFiles((now) => [...now.filter((x) => !read.some((r) => r.name === x.name)), ...read]);
    setBusy(false);
  };
  const n = got?.parts.length ?? 0;
  return (
    <Dialog
      open
      modal
      title="Import parts"
      icon="chip"
      className="bc-ec-editor bc-ec-import"
      onCancel={onCancel}
      footer={
        <>
          <Button kind="cancel" label="Cancel" onClick={onCancel} />
          <Button
            variant="primary"
            label={n ? `Add ${n} ${n === 1 ? "part" : "parts"}` : "Add"}
            disabled={!n}
            busy={busy}
            onClick={() => got && onAdd(got.parts)}
          />
        </>
      }
    >
      <label className="bc-field-label" htmlFor={`${ids}files`}>
        Library files
      </label>
      <input id={`${ids}files`} className="bc-text" type="file" multiple accept=".kicad_sym,.kicad_mod,.lbr" onChange={(e) => void pick(e.target.files)} />
      <p className="bc-note">
        From KiCad, pick a symbol library (.kicad_sym) and the footprints it uses (.kicad_mod files from a .pretty folder). From Eagle or Fusion Electronics,
        pick a library (.lbr). You can pick more than once.
      </p>
      <label className="bc-field-label" htmlFor={`${ids}from`}>
        Where they are from
      </label>
      <input id={`${ids}from`} className="bc-text" value={from} placeholder="The maker or site, for the credit" onChange={(e) => setFrom(e.target.value)} />
      <label className="bc-field-label" htmlFor={`${ids}licence`}>
        Their licence
      </label>
      <select id={`${ids}licence`} className="bc-select" value={licence} onChange={(e) => setLicence(e.target.value)}>
        {IMPORT_LICENCES.map((l) => (
          <option key={l}>{l}</option>
        ))}
      </select>
      {got && (
        <>
          <p role="status">
            Found {got.found.symbols} {got.found.symbols === 1 ? "symbol" : "symbols"} and {got.found.footprints}{" "}
            {got.found.footprints === 1 ? "footprint" : "footprints"}: {n} {n === 1 ? "part" : "parts"} to add.
          </p>
          {n > 0 && (
            <ul className="bc-ec-change-list" aria-label="Parts found">
              {got.parts.slice(0, 40).map((p, i) => (
                <li key={i}>
                  {p.name}
                  {p.packages[0] ? `, ${p.packages[0].footprint.name}` : ", no footprint"}
                </li>
              ))}
              {n > 40 && <li>And {n - 40} more.</li>}
            </ul>
          )}
          {got.notes.length > 0 && (
            <ul className="bc-ec-change-list" aria-label="Left out or worth a look">
              {got.notes.slice(0, 40).map((x, i) => (
                <li key={i} className="bc-ec-warned">
                  {x.name}: {x.why}.
                </li>
              ))}
              {got.notes.length > 40 && <li className="bc-ec-warned">And {got.notes.length - 40} more.</li>}
            </ul>
          )}
        </>
      )}
    </Dialog>
  );
}
