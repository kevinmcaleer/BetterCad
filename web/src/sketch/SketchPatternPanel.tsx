import { Button, FeatureCheck, FeaturePanel, FeatureRow, NumberField, PanelNote } from "@bettercad/ui";
import type { PatternRole, SketchPattern } from "@bettercad/sketch";
import { PATTERN_MAX, describePattern, patternSize, patternValues, ROLE_LABEL } from "@bettercad/sketch/pattern";
import type { SketchSession } from "./useSketch";

const KINDS: { id: SketchPattern["kind"]; label: string; title: string }[] = [
  { id: "rect", label: "Rectangle", title: "Copies in a row, or rows and columns" },
  { id: "circle", label: "Circle", title: "Copies round a point" },
];

/**
 * The sketch's Pattern panel, laid out as the model's Pattern panel: the kind, what it copies, its counts and
 * spacing (each a named size, so `d3 * 2` or a parameter works), Cancel and OK. Changes show in the sketch at once.
 */
export function SketchPatternPanel({ s }: { s: SketchSession }) {
  const x = s.pattern;
  const sk = s.sketch;
  const p = x.id ? sk?.patterns?.find((q) => q.id === x.id) : undefined;
  if (!sk || !p) {
    return (
      <FeaturePanel title="Pattern" icon="distributeH" cancel={{ title: "Put the tool down", onClick: () => s.pickTool("select") }}>
        <PanelNote>Click the shapes to copy: lines, arcs, circles, points or text.</PanelNote>
      </FeaturePanel>
    );
  }
  const v = patternValues(sk, p);
  const field = (role: PatternRole, opts: { count?: boolean; unit?: "mm" | "°"; max?: number } = {}) => {
    const name = patternSize(sk, p.id, role)?.name;
    return (
      <NumberField
        key={role}
        label={`${ROLE_LABEL[role]}${name ? ` (${name})` : ""}`}
        value={v[role]}
        unit={opts.count ? "none" : (opts.unit ?? "mm")}
        precision={opts.count ? 0 : undefined}
        min={opts.count ? 1 : 0.01}
        max={opts.max}
        scope={s.scope}
        onCommit={(n, expr) => x.setValue(role, n, expr)}
      />
    );
  };
  const n = p.of.length;
  const dirLine = p.dir && sk.entities.some((e) => e.id === p.dir);
  const centre = sk.entities.find((e) => e.id === p.centre);
  const atOrigin = centre?.kind === "point" && s.origin && Math.hypot(centre.x - s.origin[0], centre.y - s.origin[1]) < 1e-6;
  const note =
    x.pick === "centre"
      ? "Click a point, a circle or the origin to turn round."
      : x.pick === "dir"
        ? "Click a line or an axis for the rows to run along."
        : `${describePattern(sk, p)}. Click shapes to add or leave them out.`;
  return (
    <FeaturePanel
      title="Pattern"
      icon="distributeH"
      onFieldEnter={() => x.done()}
      cancel={{ title: x.isNew ? "Take the copies back" : "Put the pattern back as it was", onClick: x.cancel }}
      ok={{ title: "Keep the copies", onClick: x.done }}
    >
      <FeatureRow label="Kind">
        <span role="group" aria-label="Kind" className="bc-segmented">
          {KINDS.map((k) => (
            <Button key={k.id} label={k.label} title={k.title} on={p.kind === k.id} onClick={() => x.setKind(k.id)} />
          ))}
        </span>
      </FeatureRow>
      <FeatureRow label="Shapes">
        <Button
          label={n === 1 ? "1 shape" : `${n} shapes`}
          title="Click shapes in the sketch to add them to the pattern, or click one again to leave it out"
          on={x.pick === "shapes"}
          onClick={() => x.setPick("shapes")}
        />
      </FeatureRow>
      {p.kind === "rect" && (
        <>
          <FeatureRow label="Direction">
            <span role="group" aria-label="Direction" className="bc-segmented">
              <Button
                label="X"
                title="Rows run along the sketch's X axis"
                on={!dirLine && !p.alongY && x.pick !== "dir"}
                onClick={() => {
                  x.setPick("shapes");
                  x.change({ dir: undefined, alongY: undefined });
                }}
              />
              <Button
                label="Y"
                title="Rows run along the sketch's Y axis"
                on={!dirLine && !!p.alongY && x.pick !== "dir"}
                onClick={() => {
                  x.setPick("shapes");
                  x.change({ dir: undefined, alongY: true });
                }}
              />
              <Button
                label={dirLine ? "Line" : "Pick line"}
                title="Click a line or an axis for the rows to run along, and follow it when it turns"
                on={!!dirLine || x.pick === "dir"}
                onClick={() => x.setPick(x.pick === "dir" ? "shapes" : "dir")}
              />
            </span>
          </FeatureRow>
          {field("count1", { count: true, max: PATTERN_MAX })}
          {field("spacing1")}
          <FeatureCheck label="Flip" title="Copy the other way along the direction" on={!!p.flip1} onChange={(on) => x.change({ flip1: on || undefined })} />
          {field("count2", { count: true, max: PATTERN_MAX })}
          {v.count2 > 1 && (
            <>
              {field("spacing2")}
              <FeatureCheck label="Flip rows" title="Put the rows on the other side" on={!!p.flip2} onChange={(on) => x.change({ flip2: on || undefined })} />
            </>
          )}
        </>
      )}
      {p.kind === "circle" && (
        <>
          <FeatureRow label="Centre">
            <Button
              label={x.pick === "centre" ? "Picking" : atOrigin ? "Origin" : centre ? "Point" : "Pick centre"}
              title="Click a point, a circle or the origin for the copies to turn round"
              on={x.pick === "centre"}
              onClick={() => x.setPick(x.pick === "centre" ? "shapes" : "centre")}
            />
          </FeatureRow>
          {field("count", { count: true, max: PATTERN_MAX })}
          {field("angle", { unit: "°", max: 360 })}
          <FeatureCheck label="Clockwise" title="Turn the copies clockwise" on={!!p.flip1} onChange={(on) => x.change({ flip1: on || undefined })} />
        </>
      )}
      {!x.isNew && (
        <FeatureRow label="Pattern">
          <Button label="Remove" title="Take the copies away and keep the shapes" onClick={x.remove} />
        </FeatureRow>
      )}
      <PanelNote>{note}</PanelNote>
    </FeaturePanel>
  );
}
