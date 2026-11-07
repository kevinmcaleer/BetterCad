import { useState, type KeyboardEvent } from "react";
import { Banner, Button, IconButton } from "@bettercad/ui";
import { evaluateParams, paramNameProblem, paramUses, removeParamProblem, type ModelDoc, type ParamUnit, type Parameter } from "../state/document";

/**
 * Parameters (#75): named values that any size field can use ("width + 3"). Edit a row's name, expression or unit in
 * place; the value column shows what it comes to, and Used by counts the steps and parameters that use it.
 */
export interface ParamsPanelProps {
  doc: ModelDoc;
  onAdd: () => void;
  onChange: (id: string, change: Partial<Omit<Parameter, "id">>) => void;
  onRemove: (id: string) => void;
  /** Lights the steps that use a parameter on the timeline. */
  onShowUses: (featureIds: string[]) => void;
  say: (text: string, error?: boolean) => void;
}

const UNITS: { id: ParamUnit; label: string }[] = [
  { id: "mm", label: "mm" },
  { id: "deg", label: "°" },
  { id: "none", label: "No unit" },
];

/** A text cell that commits on Enter or blur, and puts the old text back on Esc. */
function Cell({ label, value, onCommit, mono }: { label: string; value: string; onCommit: (v: string) => void; mono?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() !== value) onCommit(draft.trim());
    setDraft(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    else if (e.key === "Escape" && draft !== null) {
      e.stopPropagation();
      setDraft(null);
    }
  };
  return (
    <input
      className={mono ? "bc-text bc-mono" : "bc-text"}
      aria-label={label}
      value={draft ?? value}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}

export function ParamsPanel({ doc, onAdd, onChange, onRemove, onShowUses, say }: ParamsPanelProps) {
  const params = doc.params ?? [];
  const { values, errors } = evaluateParams(params);
  const rename = (p: Parameter, name: string) => {
    const why = paramNameProblem(doc, name, p.id);
    if (why) return say(why, true);
    onChange(p.id, { name });
  };
  const remove = (p: Parameter) => {
    const why = removeParamProblem(doc, p.id);
    if (why) return say(`${why}, so it can't be deleted`, true);
    onRemove(p.id);
  };
  return (
    <>
      <div className="bc-parts-head">
        <h2 className="bc-panel-title">Parameters</h2>
        <span className="bc-note bc-count">{params.length || ""}</span>
      </div>
      <p className="bc-note">Name a value once and use it in any size field, such as “width + 3”. Change it here and every step that uses it follows.</p>
      {params.length > 0 && (
        <table className="bc-params" aria-label="Parameters">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Expression</th>
              <th scope="col">Unit</th>
              <th scope="col">Value</th>
              <th scope="col">Used by</th>
              <th scope="col">
                <span className="bc-sr-only">Delete</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {params.map((p) => {
              const error = errors.get(p.id);
              const uses = paramUses(doc, p.name);
              const n = uses.features.length + uses.params.length;
              const v = values[p.name];
              return (
                <tr key={p.id} className={error ? "bc-invalid" : undefined}>
                  <td>
                    <Cell label={`Name of ${p.name}`} value={p.name} onCommit={(name) => rename(p, name)} mono />
                  </td>
                  <td>
                    <Cell
                      label={`Expression for ${p.name}`}
                      value={p.expression}
                      onCommit={(expression) => onChange(p.id, { expression: expression || "0" })}
                      mono
                    />
                  </td>
                  <td>
                    <select
                      className="bc-select"
                      aria-label={`Unit of ${p.name}`}
                      value={p.unit}
                      onChange={(e) => onChange(p.id, { unit: e.target.value as ParamUnit })}
                    >
                      {UNITS.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="bc-params-value" aria-label={`Value of ${p.name}`}>
                    {v === undefined ? "–" : `${Math.round(v * 100) / 100}${p.unit === "mm" ? " mm" : p.unit === "deg" ? "°" : ""}`}
                  </td>
                  <td>
                    {n ? (
                      <Button
                        size="dense"
                        label={String(n)}
                        title={`Show the steps that use ${p.name}`}
                        onClick={() => onShowUses(uses.features.map((f) => f.id))}
                      />
                    ) : (
                      <span className="bc-note">0</span>
                    )}
                  </td>
                  <td>
                    <IconButton icon="trash" title={`Delete ${p.name}`} onClick={() => remove(p)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {[...errors].map(([id, why]) => (
        <Banner key={id} tone="danger">
          {params.find((p) => p.id === id)?.name}: {why}
        </Banner>
      ))}
      <Button icon="plus" label="Add parameter" onClick={onAdd} />
    </>
  );
}
