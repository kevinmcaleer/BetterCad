import { Button, Fields, NumberField, PropRow, PropsPanel, type PropsSection, type Scope } from "@bettercad/ui";
import {
  DEFAULT_INFILL,
  KIND_LABEL,
  estimateWeight,
  formatWeight,
  materialOf,
  unionBox,
  type Box3,
  type Part,
  type PrintSettings,
  type Vec3,
} from "../state/document";
import { FitMenu, type FitChoice } from "../fit/FitMenu";

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
  /** Bodies' sizes from the kernel (their bounding boxes), for bodies whose size comes from a sketch or a file. */
  sizes?: Map<string, Vec3>;
  /** Switches the selection between hole and solid. */
  onHole?: () => void;
  /** Switches the selection between reference and printed (#185). */
  onReference?: () => void;
  /** Sets the selected holes' fit (#183): the gap they cut with when grouped. */
  onFit?: (c: FitChoice) => void;
  /** Exact surface areas and bounding boxes from the kernel (#105), by part id. */
  measures?: Map<string, { area: number; bbox: Box3 }>;
  /** The document's material and infill, for the weight. */
  print?: PrintSettings;
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
const sizeText = (v: Vec3) => `${fmt(v.x)} × ${fmt(v.y)} × ${fmt(v.z)} mm. `;
const formatVolume = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-GB");

/** The right column: the selection's properties, or a summary of the model. */
/** Volume, surface, size and weight of some bodies (#105); null until the kernel has measured them all. */
function printFacts(parts: Part[], volumes: Map<string, number> | undefined, measures: PropertiesProps["measures"], print: PrintSettings | undefined) {
  const solid = parts.filter((p) => !p.hole && !p.reference);
  if (!solid.length) return null;
  const all = solid.map((p) => ({ v: volumes?.get(p.id), m: measures?.get(p.id), mesh: !!p.imported?.mesh }));
  if (all.some((x) => x.v === undefined || !x.m)) return null;
  const volume = all.reduce((a, x) => a + x.v!, 0);
  const area = all.reduce((a, x) => a + x.m!.area, 0);
  const box = unionBox(all.map((x) => x.m!.bbox))!;
  const material = materialOf(print?.material);
  const infill = print?.infill ?? DEFAULT_INFILL;
  return {
    volume,
    area,
    size: { x: box.max[0] - box.min[0], y: box.max[1] - box.min[1], z: box.max[2] - box.min[2] },
    // A mesh with holes in its surface has no true volume to weigh.
    weight: all.some((x) => x.mesh) ? null : estimateWeight({ volume, area, density: material.density, infill }),
    material: material.name,
    infill,
  };
}

const cm3 = (mm3: number) => `${(Math.round(mm3 / 100) / 10).toLocaleString("en-GB")} cm³`;
const cm2 = (mm2: number) => `${(Math.round(mm2 / 10) / 10).toLocaleString("en-GB")} cm²`;

function PrintRows({ f }: { f: NonNullable<ReturnType<typeof printFacts>> }) {
  return (
    <>
      <PropRow label="Volume">{cm3(f.volume)}</PropRow>
      <PropRow label="Surface">{cm2(f.area)}</PropRow>
      <PropRow label="Size">{sizeText(f.size).trim().replace(/\.$/, "")}</PropRow>
      <PropRow label="Weight">{f.weight === null ? "–" : `${formatWeight(f.weight)} (${f.material}, ${f.infill}% infill)`}</PropRow>
    </>
  );
}

export function Properties({
  parts,
  totalParts,
  onChange,
  onCommit,
  volumes,
  sizes,
  onHole,
  onReference,
  onFit,
  scope,
  measures,
  print,
  allParts,
}: PropertiesProps & { allParts?: Part[] }) {
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
            {(() => {
              const f = printFacts(
                (allParts ?? []).filter((p) => !p.hidden),
                volumes,
                measures,
                print,
              );
              return f ? (
                <>
                  <h2 className="bc-panel-title">Print</h2>
                  <dl className="bc-facts">
                    <dt>Volume</dt>
                    <dd>{cm3(f.volume)}</dd>
                    <dt>Weight</dt>
                    <dd>{f.weight === null ? "–" : formatWeight(f.weight)}</dd>
                  </dl>
                </>
              ) : null;
            })()}
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
          {onReference && (
            <PropRow label="Reference">
              <Button
                icon="ghost"
                label={parts.every((p) => p.reference) ? "Reference" : "Printed"}
                title="A reference body is there to design around. It doesn't print or export."
                on={parts.every((p) => p.reference)}
                onClick={onReference}
              />
            </PropRow>
          )}
          {onFit && parts.every((p) => p.hole) && (
            <PropRow label="Fit">
              <FitMenu value={{ fit: parts[0]!.fit ?? null, gap: parts[0]!.gap ?? 0 }} onChange={onFit} tuned={print?.fits} />
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
          {one && (sizes?.get(one.id) ?? one.size.x) ? sizeText(sizes?.get(one.id) ?? one.size) : ""}
          {one?.imported ? "It came from a file, so it keeps the size it came with." : "Change a body's sketch or its extrude to resize it."}
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
  const facts = printFacts(parts, volumes, measures, print);
  if (facts) sections.push({ id: "print", title: "Print", content: <PrintRows f={facts} /> });
  else if (parts.every((p) => p.reference))
    sections.push({ id: "print", title: "Print", content: <p className="bc-note">A reference body doesn't print, so it has no print weight.</p> });
  else if (parts.every((p) => p.hole))
    sections.push({ id: "print", title: "Print", content: <p className="bc-note">A hole has no weight: it cuts what it's grouped with.</p> });
  return <PropsPanel sections={sections} />;
}
