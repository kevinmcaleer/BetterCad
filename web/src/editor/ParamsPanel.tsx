import { useMemo, useState, type KeyboardEvent } from "react";
import type { Solver } from "@bettercad/sketch";
import { Banner, Button, Dialog, Icon, IconButton } from "@bettercad/ui";
import { evaluateParams, paramNameProblem, paramUses, removeParamProblem, type ModelDoc, type ParamUnit, type Parameter } from "../state/document";
import { featureIcon } from "./Timeline";
import { editModelParam, modelParams, type ModelParam } from "./modelParams";
import { loadSolver } from "../sketch/solver";

/**
 * Parameters (#75), as a wide dialog over the view, as Fusion has it. User parameters are named values that any size
 * field can use ("width + 3"): edit a row's name, expression, unit or comment in place; the value column shows what it
 * comes to, and Used by counts the steps and parameters that use it. Model parameters are the sizes each timeline step
 * was made with, grouped by step, and can be changed here too.
 */
export interface ParamsPanelProps {
  doc: ModelDoc;
  onAdd: () => void;
  onChange: (id: string, change: Partial<Omit<Parameter, "id">>) => void;
  onRemove: (id: string) => void;
  /** Lights the steps that use a parameter on the timeline. */
  onShowUses: (featureIds: string[]) => void;
  /** Changes the model as one undo step, worked out from the latest model. */
  onEdit: (label: string, fn: (d: ModelDoc) => ModelDoc) => void;
  say: (text: string, error?: boolean) => void;
}

const UNITS: { id: ParamUnit; label: string }[] = [
  { id: "mm", label: "mm" },
  { id: "deg", label: "°" },
  { id: "none", label: "No unit" },
];
const UNIT_TEXT: Record<ParamUnit, string> = { mm: "mm", deg: "°", none: "" };

const showValue = (v: number | undefined, unit: ParamUnit) =>
  v === undefined ? "–" : `${Math.round(v * 100) / 100}${unit === "mm" ? " mm" : unit === "deg" ? "°" : ""}`;

/** A text cell that commits on Enter or blur, and puts the old text back on Esc. */
function Cell({
  label,
  value,
  onCommit,
  mono,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  mono?: boolean;
  placeholder?: string;
}) {
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
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}

const has = (text: string, q: string) => text.toLowerCase().includes(q);

export function ParamsPanel({ doc, onAdd, onChange, onRemove, onShowUses, onEdit, say }: ParamsPanelProps) {
  const [filter, setFilter] = useState("");
  const [userOpen, setUserOpen] = useState(true);
  const [modelOpen, setModelOpen] = useState(true);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const q = filter.trim().toLowerCase();

  const params = doc.params ?? [];
  const { values, errors } = evaluateParams(params);
  const shownParams = q ? params.filter((p) => has(p.name, q) || has(p.expression, q) || has(p.comment ?? "", q)) : params;
  const steps = useMemo(() => modelParams(doc), [doc]);
  const shownSteps = q
    ? steps
        .map((s) => ({ ...s, params: has(s.feature.name, q) ? s.params : s.params.filter((m) => has(m.label, q) || has(m.expression, q)) }))
        .filter((s) => s.params.length)
    : steps;

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
  /** A step's size, from Model parameters: checked now, and a sketch solved again so its geometry follows. */
  const onModelChange = (id: string, path: string, expression: string) => {
    const f = doc.features.find((x) => x.id === id);
    const apply = (solver?: Solver) => {
      const r = editModelParam(doc, id, path, expression, solver);
      if (typeof r === "string") return say(r, true);
      onEdit(`Edit ${f?.name ?? "step"}`, (d) => {
        const next = editModelParam(d, id, path, expression, solver);
        return typeof next === "string" ? d : next;
      });
    };
    if (f?.type === "sketch") void loadSolver().then(apply);
    else apply();
  };
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="bc-params-body">
      <div className="bc-params-tools">
        <input
          className="bc-text bc-grow"
          type="search"
          aria-label="Filter parameters"
          placeholder="Filter parameters"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && filter) {
              e.stopPropagation();
              setFilter("");
            }
          }}
        />
        <Button icon="plus" label="Add parameter" onClick={onAdd} />
      </div>
      <table className="bc-params" aria-label="Parameters">
        <colgroup>
          <col className="bc-params-col-name" />
          <col className="bc-params-col-expr" />
          <col className="bc-params-col-unit" />
          <col className="bc-params-col-value" />
          <col className="bc-params-col-comment" />
          <col className="bc-params-col-uses" />
          <col className="bc-params-col-act" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Expression</th>
            <th scope="col">Unit</th>
            <th scope="col">Value</th>
            <th scope="col">Comment</th>
            <th scope="col">Used by</th>
            <th scope="col">
              <span className="bc-sr-only">Delete</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="bc-params-group">
            <th scope="rowgroup" colSpan={7}>
              <button type="button" className="bc-params-toggle" aria-expanded={userOpen} onClick={() => setUserOpen(!userOpen)}>
                <Icon name="chevron" size={14} />
                <span>User parameters</span>
                <span className="bc-note">{params.length || ""}</span>
              </button>
            </th>
          </tr>
          {userOpen && !params.length && (
            <tr>
              <td colSpan={7} className="bc-note bc-params-empty">
                Name a value once and use it in any size field, such as “width + 3”. Change it here and every step that uses it follows.
              </td>
            </tr>
          )}
          {userOpen &&
            shownParams.map((p) => {
              const error = errors.get(p.id);
              const uses = paramUses(doc, p.name);
              const n = uses.features.length + uses.params.length;
              return (
                <tr key={p.id} className={error ? "bc-invalid bc-params-user" : "bc-params-user"}>
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
                    {showValue(values[p.name], p.unit)}
                  </td>
                  <td>
                    <Cell label={`Comment for ${p.name}`} value={p.comment ?? ""} onCommit={(comment) => onChange(p.id, { comment: comment || undefined })} />
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
          <tr className="bc-params-group">
            <th scope="rowgroup" colSpan={7}>
              <button type="button" className="bc-params-toggle" aria-expanded={modelOpen} onClick={() => setModelOpen(!modelOpen)}>
                <Icon name="chevron" size={14} />
                <span>Model parameters</span>
                <span className="bc-note">{steps.length || ""}</span>
              </button>
            </th>
          </tr>
          {modelOpen && !steps.length && (
            <tr>
              <td colSpan={7} className="bc-note bc-params-empty">
                No sizes yet. Each step you add lists its sizes here, such as an extrude’s distance or a sketch’s dimensions.
              </td>
            </tr>
          )}
          {modelOpen &&
            shownSteps.map(({ feature: f, params: list }) => {
              const expanded = !!q || open.has(f.id);
              return [
                <tr key={f.id} className="bc-params-step">
                  <th scope="row" colSpan={7}>
                    <button
                      type="button"
                      className="bc-params-toggle"
                      aria-expanded={expanded}
                      title={expanded ? `Hide the sizes of ${f.name}` : `Show the sizes of ${f.name}`}
                      onClick={() => toggle(f.id)}
                    >
                      <Icon name="chevron" size={14} />
                      <Icon name={featureIcon(f)} size={16} />
                      <span>{f.name}</span>
                      <span className="bc-note">{list.length}</span>
                    </button>
                  </th>
                </tr>,
                ...(expanded
                  ? list.map((m) => <ModelRow key={`${f.id}:${m.path}`} featureName={f.name} m={m} onCommit={(e) => onModelChange(f.id, m.path, e)} />)
                  : []),
              ];
            })}
        </tbody>
      </table>
      {[...errors].map(([id, why]) => (
        <Banner key={id} tone="danger">
          {params.find((p) => p.id === id)?.name}: {why}
        </Banner>
      ))}
    </div>
  );
}

function ModelRow({ featureName, m, onCommit }: { featureName: string; m: ModelParam; onCommit: (expression: string) => void }) {
  const label = `${m.label} of ${featureName}`;
  return (
    <tr className="bc-params-model">
      <td className="bc-params-label">{m.label}</td>
      <td>
        {m.readOnly ? (
          <span className="bc-note" title="A driven size only reports">
            {m.expression}
          </span>
        ) : (
          <Cell label={label} value={m.expression} onCommit={(e) => e && onCommit(e)} mono />
        )}
      </td>
      <td className="bc-note">{UNIT_TEXT[m.unit]}</td>
      <td className="bc-params-value" aria-label={`Value of ${label}`}>
        {showValue(m.value, m.unit)}
      </td>
      <td colSpan={3} />
    </tr>
  );
}

export interface ParamsDialogProps extends ParamsPanelProps {
  onClose: () => void;
}

/** The Parameters dialog: wide, floating over the view, leaving the browser where it is. */
export function ParamsDialog({ onClose, ...p }: ParamsDialogProps) {
  return (
    <Dialog open title="Parameters" icon="sliders" onCancel={onClose} footer={null} className="bc-params-dialog">
      <ParamsPanel {...p} />
    </Dialog>
  );
}
