import { Fields, NumberField, PropRow, PropsPanel, type PropsSection } from "@bettercad/ui";
import { KIND_LABEL, type Part, type Vec3 } from "../state/document";

export interface PropertiesProps {
  parts: Part[];
  totalParts: number;
  /** Live change to every selected part; merges into one undo step until onCommit. */
  onChange: (key: "position" | "size" | "rotation", axis: keyof Vec3, value: number) => void;
  onCommit: () => void;
}

const AXES: (keyof Vec3)[] = ["x", "y", "z"];
const SIZE_LABEL: Record<keyof Vec3, string> = { x: "W", y: "D", z: "H" };

/** The value all parts share, or null (shown as "–") when they differ. */
function shared(parts: Part[], key: "position" | "size" | "rotation", axis: keyof Vec3): number | null {
  const of = (p: Part) => (key === "rotation" ? (p.rotation?.[axis] ?? 0) : p[key][axis]);
  const first = of(parts[0]!);
  return parts.every((p) => of(p) === first) ? first : null;
}

/** The right column: the selection's properties, or a summary of the model. */
export function Properties({ parts, totalParts, onChange, onCommit }: PropertiesProps) {
  if (parts.length === 0) {
    return (
      <PropsPanel
        sections={[]}
        empty={
          <>
            <h2 className="bc-panel-title">This model</h2>
            <p className="bc-note">Select something to see its properties.</p>
            <dl className="bc-facts">
              <dt>Parts</dt>
              <dd>{totalParts}</dd>
              <dt>Units</dt>
              <dd>mm</dd>
              <dt>Up</dt>
              <dd>Z</dd>
            </dl>
          </>
        }
      />
    );
  }
  const one = parts.length === 1 ? parts[0]! : null;
  const fields = (key: "position" | "size" | "rotation") => (
    <Fields>
      {AXES.map((a) => (
        <NumberField
          key={a}
          label={key === "size" ? SIZE_LABEL[a] : a.toUpperCase()}
          value={shared(parts, key, a)}
          min={key === "size" ? 0.01 : undefined}
          unit={key === "rotation" ? "°" : "mm"}
          onChange={(v) => onChange(key, a, v)}
          onCommit={onCommit}
        />
      ))}
    </Fields>
  );
  const sections: PropsSection[] = [
    {
      id: "part",
      title: one ? "This part" : `${parts.length} parts`,
      content: (
        <>
          <PropRow label="Name">{one ? one.name : "Several"}</PropRow>
          <PropRow label="Shape">{one ? KIND_LABEL[one.kind] : [...new Set(parts.map((p) => KIND_LABEL[p.kind]))].join(", ")}</PropRow>
        </>
      ),
    },
    { id: "size", title: "Size", content: fields("size") },
    {
      id: "position",
      title: "Position",
      content: (
        <>
          {fields("position")}
          <p className="bc-note">Type a sum like 40/2 + 5. Drag a label to scrub. Arrow keys step 1 mm, Shift 10, Alt 0.1.</p>
        </>
      ),
    },
    { id: "rotation", title: "Rotation", content: fields("rotation") },
  ];
  return <PropsPanel sections={sections} />;
}
