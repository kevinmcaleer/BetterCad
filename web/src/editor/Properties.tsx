import { Button, Fields, NumberField, PropRow, PropsPanel, type PropsSection, type Scope } from "@bettercad/ui";
import { KIND_LABEL, type Part, type Vec3 } from "../state/document";

export interface PropertiesProps {
  parts: Part[];
  totalParts: number;
  /** Live change to every selected part; merges into one undo step until onCommit. */
  onChange: (key: "position" | "size" | "rotation", axis: keyof Vec3, value: number) => void;
  /** The edit is finished: with the expression typed, when it was more than a number (#75). */
  onCommit: (key: "position" | "size" | "rotation", axis: keyof Vec3, value: number, expression?: string) => void;
  /** Parameter values the fields can use. */
  scope?: Scope;
  /** Exact volumes from the kernel, by part id, once built. */
  volumes?: Map<string, number>;
  /** Switches the selection between hole and solid. */
  onHole?: () => void;
}

const AXES: (keyof Vec3)[] = ["x", "y", "z"];
const SIZE_LABEL: Record<keyof Vec3, string> = { x: "W", y: "D", z: "H" };

/** The value all parts share, or null (shown as "–") when they differ. */
function shared(parts: Part[], key: "position" | "size" | "rotation", axis: keyof Vec3): number | null {
  const of = (p: Part) => (key === "rotation" ? (p.rotation?.[axis] ?? 0) : p[key][axis]);
  const first = of(parts[0]!);
  return parts.every((p) => of(p) === first) ? first : null;
}

const fmt = (v: number) => String(Math.round(v * 100) / 100);
const formatVolume = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-GB");

/** The right column: the selection's properties, or a summary of the model. */
export function Properties({ parts, totalParts, onChange, onCommit, volumes, onHole, scope }: PropertiesProps) {
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
  const vols = parts.map((p) => volumes?.get(p.id));
  const volume = vols.every((v) => v !== undefined) ? vols.reduce<number>((a, v) => a + v!, 0) : null;
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
          onCommit={(v, expr) => onCommit(key, a, v, expr)}
          scope={scope}
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
          {volume !== null && <PropRow label="Volume">{`${formatVolume(volume)} mm³`}</PropRow>}
          {onHole && (
            <PropRow label="Hole">
              <Button
                icon="hole"
                label={parts.every((p) => p.hole) ? "Hole" : "Solid"}
                title="A hole cuts the bodies it is grouped with"
                on={parts.every((p) => p.hole)}
                onClick={onHole}
              />
            </PropRow>
          )}
        </>
      ),
    },
    {
      id: "size",
      title: "Size",
      // A body's size comes from its sketch and extrude, so it is shown, not typed.
      content: parts.some((p) => p.kind === "solid") ? (
        <p className="bc-note">
          {one ? `${fmt(one.size.x)} × ${fmt(one.size.y)} × ${fmt(one.size.z)} mm. ` : ""}Change a body's sketch or its extrude to resize it.
        </p>
      ) : (
        fields("size")
      ),
    },
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
