import { byRef, changePart, realParts, tidyValue, type ElectronicsDesign, type Part } from "@bettercad/electronics";
import { COMMON_CHECKED, commonMatches, fillCommon } from "@bettercad/electronics/fab/common";
import { addVariant, partIn, removeVariant, renameVariant, setVariantFitted, setVariantValue, variantChanges } from "@bettercad/electronics/variants";
import { Button, Dialog } from "@bettercad/ui";
import { useState } from "react";
import type { EEdit } from "./actions";

export type Column = "value" | "lcsc" | "mpn";
const COLUMNS: { id: Column; label: string }[] = [
  { id: "value", label: "Value" },
  { id: "lcsc", label: "LCSC number" },
  { id: "mpn", label: "Maker's part number" },
];

const cell = (d: ElectronicsDesign, p: Part, col: Column): string => (col === "value" ? p.value : ((p.supplier ?? d.defs[p.def]?.supplier)?.[col] ?? ""));

/** One cell changed. Values are read as shorthand (4k7); an emptied part number goes back to the component's own. */
export function setCell(d: ElectronicsDesign, id: string, col: Column, text: string): ElectronicsDesign {
  const p = d.parts.find((x) => x.id === id);
  if (!p) return d;
  const t = text.trim();
  if (col === "value") return t && t !== p.value ? changePart(d, id, { value: tidyValue(t, d.defs[p.def]?.prefix ?? "") }) : d;
  if (t === cell(d, p, col)) return d;
  return changePart(d, id, { supplier: { ...p.supplier, [col]: t || undefined } });
}

/** A column of text pasted into a cell: one line per part, going down from that row. Blank lines skip a part. */
export function fillColumn(d: ElectronicsDesign, ids: string[], col: Column, lines: string[]): ElectronicsDesign {
  return lines.reduce((next, line, i) => (ids[i] && line.trim() ? setCell(next, ids[i]!, col, line) : next), d);
}

/** Names in a sentence: "R1", "R1 and R2", "R1, R2, R3 and 4 more". */
const listed = (refs: string[]): string => {
  const shown = refs.length > 4 ? [...refs.slice(0, 3), `${refs.length - 3} more`] : refs;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : (shown[0] ?? "");
};

/** The parts of the design, in name order: the table's rows, and the order a pasted column fills. */
export const tableRows = (d: ElectronicsDesign): Part[] => realParts(d).sort((a, b) => byRef(a.ref, b.ref));

/**
 * The parts table (#633): every part on one screen, to change many at once. Paste a column from a spreadsheet into
 * a cell and it fills the rows below.
 */
export default function PartsTable({ design, edit, readOnly, onClose }: { design: ElectronicsDesign; edit: EEdit; readOnly?: boolean; onClose: () => void }) {
  // A variant (#758): the table shows and changes that build's fitted parts and values, not the drawing's.
  const [variantId, setVariant] = useState<string | null>(null);
  const variant = design.variants?.find((v) => v.id === variantId);
  const rows = tableRows(design).map((p) => partIn(variant, p));
  const changes = variant ? variantChanges(design, variant.id) : [];
  // Everyday resistors and capacitors whose LCSC numbers are known (#661). Offered, never filled in for you.
  const common = commonMatches(design);
  const [filled, setFilled] = useState("");
  return (
    <Dialog open modal title="Parts" icon="list" width={760} className="bc-ec-table-dialog" onCancel={onClose}>
      {rows.length === 0 ? (
        <p className="bc-note">There are no parts yet.</p>
      ) : (
        <>
          <div className="bc-ec-variant-bar">
            <label className="bc-field">
              <span>Build</span>
              <select className="bc-select" aria-label="Build" value={variant?.id ?? ""} onChange={({ target: { value } }) => setVariant(value || null)}>
                <option value="">As drawn</option>
                {(design.variants ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            {!readOnly && (
              <Button
                label="New variant"
                onClick={() => {
                  const made = addVariant(design);
                  edit(() => made.design, "New variant");
                  setVariant(made.id);
                }}
              />
            )}
            {variant && !readOnly && (
              <>
                <input
                  className="bc-text"
                  aria-label="Variant name"
                  defaultValue={variant.name}
                  key={variant.id + variant.name}
                  onBlur={(e) => e.target.value.trim() !== variant.name && edit((d) => renameVariant(d, variant.id, e.target.value), "Rename variant")}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
                <Button
                  label="Delete variant"
                  onClick={() => {
                    edit((d) => removeVariant(d, variant.id), "Delete variant");
                    setVariant(null);
                  }}
                />
              </>
            )}
          </div>
          <p className="bc-note" role={variant ? "status" : undefined}>
            {variant
              ? changes.length
                ? `${variant.name} changes ${listed(changes)}. Values and Fitted here change this build only.`
                : `${variant.name} is the same as the drawing so far. Values and Fitted here change this build only.`
              : "Change a cell and move on to keep it. Paste a column from a spreadsheet into a cell to fill the rows below."}
          </p>
          {(common.length > 0 || filled) && (
            <p className="bc-note" role="status">
              {common.length > 0 ? (
                <>
                  {listed(common.map((m) => m.ref))} {common.length === 1 ? "matches a common part" : "match common parts"} with an LCSC number, read from
                  JLCPCB on {COMMON_CHECKED}.{" "}
                  {!readOnly && (
                    <Button
                      label={common.length === 1 ? "Fill in its number" : "Fill in their numbers"}
                      onClick={() => {
                        setFilled(
                          `Filled in ${common.length === 1 ? "the number" : "the numbers"} for ${listed(common.map((m) => m.ref))}. Check each part suits your circuit: ${common
                            .slice(0, 3)
                            .map((m) => `${m.ref} is ${m.common.spec}`)
                            .join("; ")}${common.length > 3 ? ", and so on" : ""}.`,
                        );
                        edit(fillCommon, `Fill in ${common.length} part ${common.length === 1 ? "number" : "numbers"}`);
                      }}
                    />
                  )}
                </>
              ) : (
                filled
              )}
            </p>
          )}
          <div className="bc-ec-table-wrap">
            <table className="bc-ec-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Part</th>
                  {COLUMNS.slice(0, 1).map((c) => (
                    <th key={c.id} scope="col">
                      {c.label}
                    </th>
                  ))}
                  <th scope="col">Package</th>
                  {COLUMNS.slice(1).map((c) => (
                    <th key={c.id} scope="col">
                      {c.label}
                    </th>
                  ))}
                  <th scope="col">Fitted</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => {
                  const def = design.defs[p.def];
                  const input = (col: Column) => (
                    <td key={col}>
                      <input
                        className="bc-text"
                        aria-label={`${COLUMNS.find((c) => c.id === col)!.label} of ${p.ref}`}
                        defaultValue={cell(design, p, col)}
                        key={cell(design, p, col)}
                        disabled={readOnly}
                        onBlur={(e) => {
                          const text = e.target.value;
                          if (text.trim() === cell(design, p, col)) return;
                          if (variant && col === "value")
                            edit(
                              (d) => setVariantValue(d, variant.id, p.id, tidyValue(text.trim(), d.defs[p.def]?.prefix ?? "")),
                              `Change ${p.ref} in ${variant.name}`,
                            );
                          else edit((d) => setCell(d, p.id, col, text), `Change ${p.ref}`);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                        onPaste={(e) => {
                          const lines = e.clipboardData.getData("text").replace(/\r/g, "").replace(/\n$/, "").split("\n");
                          if (lines.length < 2) return;
                          e.preventDefault();
                          const ids = rows.slice(i).map((r) => r.id);
                          edit((d) => fillColumn(d, ids, col, lines), `Paste ${Math.min(lines.length, ids.length)} values`);
                        }}
                      />
                    </td>
                  );
                  return (
                    <tr key={p.id}>
                      <th scope="row">{p.ref}</th>
                      <td>{def?.name}</td>
                      {input("value")}
                      <td>
                        <select
                          className="bc-select"
                          aria-label={`Package of ${p.ref}`}
                          value={p.pkg}
                          disabled={readOnly || (def?.packages.length ?? 0) < 2}
                          onChange={({ target: { value } }) => edit((d) => changePart(d, p.id, { pkg: Number(value) }), `Change ${p.ref}`)}
                        >
                          {def?.packages.map((k, n) => (
                            <option key={n} value={n}>
                              {k.footprint.name}
                            </option>
                          ))}
                          {!def?.packages.length && <option value={0}>No footprint</option>}
                        </select>
                      </td>
                      {input("lcsc")}
                      {input("mpn")}
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${p.ref} is fitted`}
                          checked={p.fitted !== false}
                          disabled={readOnly}
                          onChange={({ target: { checked } }) =>
                            variant
                              ? edit((d) => setVariantFitted(d, variant.id, [p.id], checked), `Change ${p.ref} in ${variant.name}`)
                              : edit((d) => changePart(d, p.id, { fitted: checked ? undefined : false }), `Change ${p.ref}`)
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Dialog>
  );
}
