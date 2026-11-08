import { Banner, Button, NumberField, PropRow, PropsPanel, type PropsSection } from "@bettercad/ui";
import { CONSTRAINT_LABEL } from "@bettercad/sketch";
import { formatCombo } from "../state/commands";
import { OPTION_ROWS } from "./options";
import { DIM_LABEL } from "./SketchUI";
import type { SketchSession } from "./useSketch";

/**
 * The sketch palette, floating on the right while a sketch is open, after Fusion's: how constrained the sketch is,
 * its plane, what the view shows (the grid, snapping, profiles, points, sizes, constraint marks, projected and
 * construction geometry), Look at, the sizes and constraints, and Finish sketch at the foot.
 */
export function SketchPanel({ s }: { s: SketchSession }) {
  if (!s.sketch || !s.feature) return null;
  const sk = s.sketch;
  const conflicting = new Set(s.result?.conflicting ?? []);
  const redundant = new Set(s.result?.redundant ?? []);
  const plane = sk.plane.kind === "world" ? `${sk.plane.plane} plane` : "A face";
  const state = conflicting.size > 0 ? "bad" : s.result?.dof === 0 ? "done" : "free";
  const sections: PropsSection[] = [
    {
      id: "sketch",
      title: s.feature.name,
      content: (
        <>
          <p className={`bc-sk-status bc-sk-${state}`} role="status">
            <span className="bc-sk-dot" aria-hidden="true" />
            {s.status}
          </p>
          <PropRow label="On">{plane}</PropRow>
          <NumberField label="Offset" value={sk.plane.offset} step={1} onCommit={(v) => s.setOffset(v)} />
          {conflicting.size > 0 && <Banner tone="danger">Some constraints fight each other. Delete one of the ones in red.</Banner>}
          {s.finishWarn && (
            <Banner
              tone="warn"
              action={
                <span className="bc-row-actions">
                  <Button label="Finish anyway" variant="secondary" onClick={() => s.finish(true)} />
                  <Button label="Keep drawing" onClick={() => s.setFinishWarn(false)} />
                </span>
              }
            >
              This sketch has no closed shape yet, so it can't be extruded.
            </Banner>
          )}
        </>
      ),
    },
    {
      id: "sketch-options",
      title: "Options",
      content: (
        <>
          <div className="bc-check-row">
            <span>Look at</span>
            <Button icon="camera" size="dense" title="Look straight at the sketch" onClick={s.lookAtSketch} />
          </div>
          {OPTION_ROWS.map((o) => (
            <label key={o.id} className="bc-check-row" title={o.title}>
              <span>{o.label}</span>
              <input type="checkbox" checked={s.options[o.id]} onChange={(e) => s.setOption(o.id, e.currentTarget.checked)} />
            </label>
          ))}
        </>
      ),
    },
    {
      id: "sketch-sizes",
      title: "Sizes",
      content: sk.dimensions.length ? (
        <>
          {sk.dimensions.map((d, i) => (
            <NumberField
              key={d.id}
              label={`${DIM_LABEL[d.kind]} ${i + 1}`}
              value={Math.round(d.value * 1000) / 1000}
              unit={d.kind === "angle" ? "°" : "mm"}
              locked={!d.driving}
              scope={s.scope}
              onCommit={(v, expr) => s.setDimension(d.id, expr ?? String(v))}
            />
          ))}
        </>
      ) : (
        <p className="bc-note">Press {formatCombo("d")} and click a line or circle to give it a size.</p>
      ),
    },
    {
      id: "sketch-constraints",
      title: `Constraints (${sk.constraints.length})`,
      content: sk.constraints.length ? (
        <ul className="bc-sk-list" aria-label="Constraints">
          {sk.constraints.map((c) => (
            <li key={c.id} className={conflicting.has(c.id) ? "bc-bad" : undefined}>
              <button type="button" className="bc-sk-item" aria-pressed={s.sel.includes(c.id)} onClick={() => s.setSel([c.id])}>
                {CONSTRAINT_LABEL[c.type]}
                {conflicting.has(c.id) ? " (fights)" : redundant.has(c.id) ? " (repeats)" : ""}
              </button>
              <Button
                icon="trash"
                size="dense"
                title={`Delete the ${CONSTRAINT_LABEL[c.type].toLowerCase()} constraint`}
                onClick={() => {
                  s.setSel([c.id]);
                  setTimeout(s.removeSelected, 0);
                }}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="bc-note">Pick lines or points, then choose Constrain.</p>
      ),
    },
  ];
  return (
    <PropsPanel
      label="Sketch palette"
      sections={sections}
      footer={<Button kind="done" icon="finish" label="Finish sketch" title="Finish the sketch" shortcut="Enter" onClick={() => s.finish()} />}
    />
  );
}
