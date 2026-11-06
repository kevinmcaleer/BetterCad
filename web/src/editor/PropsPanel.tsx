import { Fields, NumberField } from "@bettercad/ui";
import { KIND_LABEL, type ModelDoc, type Part, type Vec3 } from "../state/document";

export interface PropsPanelProps {
  part: Part | null;
  doc: ModelDoc;
  onChange: (change: Partial<Omit<Part, "id">>, label: string, coalesceKey?: string) => void;
  /** Ends a run of edits so the next one is its own undo step. */
  onCommit: () => void;
}

const AXES: (keyof Vec3)[] = ["x", "y", "z"];

/** The right column: the selection's properties, or a summary of the model. */
export function PropsPanel({ part, doc, onChange, onCommit }: PropsPanelProps) {
  if (!part) {
    return (
      <aside className="bc-side bc-props" aria-label="Properties">
        <h2 className="bc-panel-title">This model</h2>
        <p className="bc-note">Select something to see its properties.</p>
        <dl className="bc-facts">
          <dt>Parts</dt>
          <dd>{doc.parts.length}</dd>
          <dt>Units</dt>
          <dd>mm</dd>
          <dt>Up</dt>
          <dd>Z</dd>
        </dl>
      </aside>
    );
  }
  const vec = (key: "position" | "size", axis: keyof Vec3, v: number) =>
    onChange({ [key]: { ...part[key], [axis]: v } }, key === "size" ? `Resize ${part.name}` : `Move ${part.name}`, `${part.id}.${key}.${axis}`);
  const sizeLabels: Record<keyof Vec3, string> = { x: "W", y: "D", z: "H" };
  return (
    <aside className="bc-side bc-props" aria-label="Properties" onBlur={onCommit} onPointerUp={onCommit}>
      <h2 className="bc-panel-title">This part</h2>
      <p className="bc-note">
        {KIND_LABEL[part.kind]}
        {part.hidden ? ", hidden" : ""}
      </p>
      <h3 className="bc-sub">Size</h3>
      <Fields>
        {AXES.map((a) => (
          <NumberField key={a} label={sizeLabels[a]} value={part.size[a]} min={0.01} onChange={(v) => vec("size", a, v)} />
        ))}
      </Fields>
      <h3 className="bc-sub">Position</h3>
      <Fields>
        {AXES.map((a) => (
          <NumberField key={a} label={a.toUpperCase()} value={part.position[a]} onChange={(v) => vec("position", a, v)} />
        ))}
      </Fields>
      <p className="bc-note">Drag a label to scrub. Arrow keys step by 1 mm, Shift by 10, Alt by 0.1.</p>
    </aside>
  );
}
