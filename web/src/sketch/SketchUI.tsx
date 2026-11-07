import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { ArmedBar, Banner, Button, MenuButton, NumberField, evaluate, PropRow, PropsPanel, ToolButton, Toolbar, type PropsSection } from "@bettercad/ui";
import {
  CONSTRAINT_LABEL,
  SketchIndex,
  add,
  angleOf,
  constraintRefs,
  formatDimension,
  mid,
  norm,
  perp,
  polar,
  scale,
  sub,
  toWorld,
  type Constraint,
  type Dimension,
  type Entity,
  type Id,
  type Vec2,
} from "@bettercad/sketch";
import { formatCombo } from "../state/commands";
import { SNAP_LABEL } from "./snap";
import { CONSTRAINT_TOOLS, SKETCH_TOOLS, constraintToolById, isDrawTool, levelOrUpright, toolById } from "./tools";
import type { SketchSession } from "./useSketch";

/** The sketch tool bar and the armed tool's strip, in place of the model bars while a sketch is open. */
export function SketchBars({ s }: { s: SketchSession }) {
  const tool = toolById(s.stool);
  const drawing = isDrawTool(s.stool);
  const onFieldKey = (e: ReactKeyboardEvent) => {
    if (e.key !== "Enter") return;
    // The shape is made with what the field holds now, which its own commit has not rendered yet.
    const el = e.target as HTMLInputElement;
    const i = Number(el.closest("[data-field]")?.getAttribute("data-field"));
    let v: number | undefined;
    try {
      v = el.value.trim() ? evaluate(el.value) : undefined;
    } catch {
      return;
    }
    const typed = Number.isInteger(i) && v !== undefined && v > 0 ? Object.assign([...s.typed], { [i]: v }) : undefined;
    // Now, not after a timeout: an Esc pressed straight after would clear the shape first.
    s.commitTyped(typed);
  };
  return (
    <>
      <Toolbar label="Sketch tools">
        {SKETCH_TOOLS.map((t) => (
          <ToolButton
            key={t.id}
            icon={t.icon}
            label={t.label}
            shortcut={t.key.toUpperCase()}
            pressed={s.stool === t.id && !s.ctool}
            showLabel
            onPress={() => s.pickTool(t.id)}
          />
        ))}
        <Toolbar.Separator />
        <MenuButton
          label="Constraints"
          entries={CONSTRAINT_TOOLS.map((c) => ({ id: c.id, label: c.label, onSelect: () => s.constrain(c.id) }))}
          trigger={(p) => (
            <Button {...p} icon="constraint" label="Constrain" on={!!s.ctool} title="Pick a constraint, then click the geometry. Esc puts it down." />
          )}
        />
        <Toolbar.Separator />
        <Button kind="done" icon="finish" label="Finish sketch" title="Finish the sketch" shortcut="Enter" onClick={() => s.finish()} />
      </Toolbar>
      <ArmedBar title={s.ctool ? constraintToolById(s.ctool).label : tool.label} icon={s.ctool ? "constraint" : tool.icon}>
        {drawing && tool.fields.length > 0 && (
          <span className="bc-sk-fields" onKeyDown={onFieldKey}>
            {tool.fields.map((f, i) => (
              <span key={`${s.stool}-${f}`} data-field={i}>
                <NumberField
                  key={`${s.stool}-${f}`}
                  id={`bc-sk-field-${i}`}
                  label={f}
                  value={s.typed[i] ?? (s.clicks.length ? round(s.previewValues[i]) : null)}
                  min={0.001}
                  onCommit={(v) => s.setTyped((t) => Object.assign([...t], { [i]: v }))}
                />
              </span>
            ))}
          </span>
        )}
        {s.stool === "fillet" && <NumberField label="Radius" value={s.filletR} min={0.01} onCommit={(v) => s.setFilletR(v)} />}
        {s.stool === "offset" && <NumberField label="Distance" value={s.offsetD} min={0.01} onCommit={(v) => s.setOffsetD(v)} />}
        {s.stool === "project" && (
          <Button
            label="As construction"
            title="Projected edges guide the sketch without making shapes"
            on={s.projectGuide}
            onClick={() => s.setProjectGuide(!s.projectGuide)}
          />
        )}
        {s.stool === "polygon" && (
          <NumberField label="Sides" unit="none" value={s.sides} min={3} max={12} step={1} precision={0} onCommit={(v) => s.setSides(Math.round(v))} />
        )}
        {drawing && <Button label="Grid" title="Snap to the grid. Hold Shift to place freely." on={s.gridSnap} onClick={() => s.setGridSnap(!s.gridSnap)} />}
        <Button label="Constraints" title="Show the constraint marks" on={s.showConstraints} onClick={() => s.setShowConstraints(!s.showConstraints)} />
        <span className="bc-armed-note">{s.status}</span>
      </ArmedBar>
    </>
  );
}

/** The plane picker's strip while the Sketch tool waits for a plane or face. */
export function SketchPickBar({ onCancel }: { onCancel: () => void }) {
  return (
    <ArmedBar title="Sketch" icon="sketch">
      <span className="bc-armed-note">Click a face or a plane to sketch on it.</span>
      <Button kind="cancel" label="Cancel" title="Put the tool down" shortcut="Esc" onClick={onCancel} />
    </ArmedBar>
  );
}

const DIM_LABEL: Record<Dimension["kind"], string> = {
  length: "Length",
  distance: "Distance",
  distanceX: "Across",
  distanceY: "Up",
  radius: "Radius",
  diameter: "Diameter",
  angle: "Angle",
};

const round = (v: number | undefined) => (v === undefined ? null : Math.round(v * 100) / 100);

const GLYPH: Partial<Record<Constraint["type"], string>> = {
  horizontal: "H",
  vertical: "V",
  parallel: "∥",
  perpendicular: "⊥",
  tangent: "T",
  equal: "=",
  concentric: "◎",
  midpoint: "M",
  fix: "F",
  symmetric: "S",
};

/** Where a dimension's pill sits, in sketch mm. */
function dimAnchor(idx: SketchIndex, d: Dimension, px: number, centre: Vec2): Vec2 {
  const [r0, r1] = d.refs;
  const e0 = idx.get(r0!);
  const e1 = r1 ? idx.get(r1) : undefined;
  let base: Vec2 = [0, 0];
  if (d.kind === "length" && e0?.kind === "line") {
    const a = idx.xy(e0.a);
    const b = idx.xy(e0.b);
    // Outside the shape: on the side of the line away from the middle of the sketch.
    const n = perp(norm(sub(b, a)));
    const m = mid(a, b);
    const side = n[0] * (centre[0] - m[0]) + n[1] * (centre[1] - m[1]) > 0 ? -1 : 1;
    base = add(m, scale(n, side * 18 * px));
  } else if ((d.kind === "radius" || d.kind === "diameter") && (e0?.kind === "circle" || e0?.kind === "arc")) {
    const c = idx.xy(e0.c);
    const ang = e0.kind === "arc" ? (angleOf(sub(idx.xy(e0.a), c)) + angleOf(sub(idx.xy(e0.b), c))) / 2 : Math.PI / 4;
    base = polar(c, e0.r, ang);
  } else if (e0 && e1) base = mid(anchorOf(idx, e0), anchorOf(idx, e1));
  else if (e0) base = anchorOf(idx, e0);
  return add(base, d.labelOffset);
}

function anchorOf(idx: SketchIndex, e: Entity): Vec2 {
  if (e.kind === "point") return [e.x, e.y];
  if (e.kind === "line") return mid(idx.xy(e.a), idx.xy(e.b));
  if (e.kind === "circle") return polar(idx.xy(e.c), e.r, -Math.PI / 4);
  const c = idx.xy(e.c);
  return polar(c, e.r, (angleOf(sub(idx.xy(e.a), c)) + angleOf(sub(idx.xy(e.b), c))) / 2);
}

/** Typing a size into a dimension's pill. Enter or leaving the field sets it; Esc (through the Esc stack) cancels. */
function DimInput({ x, y, label, value, onDone }: { x: number; y: number; label: string; value: string; onDone: (text: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    // After the click that opened it has finished moving focus to the view.
    const t = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const finish = (text: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };
  return (
    <input
      ref={ref}
      className="bc-dim bc-dim-input"
      style={{ left: x, top: y }}
      aria-label={label}
      defaultValue={value}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(e.currentTarget.value);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

/** The labels over the sketch: dimension pills (double-click to type a size), constraint marks and the snap label. */
export function SketchLabels({ s }: { s: SketchSession }) {
  const eng = s.engineOf();
  if (!s.sketch || !s.frame || !eng) return null;
  const frame = s.frame;
  const px = eng.pixelSize(frame.origin);
  const at = (xy: Vec2) => eng.project(toWorld(frame, xy));
  const idx = new SketchIndex(s.sketch);
  const pts = s.sketch.entities.flatMap((e) => (e.kind === "point" ? [[e.x, e.y] as Vec2] : []));
  const centre: Vec2 = pts.length ? scale(pts.reduce(add, [0, 0] as Vec2), 1 / pts.length) : [0, 0];
  const conflicting = new Set(s.result?.conflicting ?? []);
  const pick = (id: Id, e: ReactMouseEvent) => s.setSel((sel) => (e.shiftKey ? (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]) : [id]));

  const placed = new Map<string, number>();
  const glyphs = s.showConstraints
    ? s.sketch.constraints.flatMap((c) => {
        const g = GLYPH[c.type];
        const e = idx.get(constraintRefs(c)[c.type === "midpoint" ? 1 : 0]!);
        if (!g || !e) return [];
        const key = e.id;
        const n = placed.get(key) ?? 0;
        placed.set(key, n + 1);
        // On a line the marks sit inside the shape, away from its size pill, in a row along it.
        let xy = anchorOf(idx, e);
        if (e.kind === "line") {
          const a = idx.xy(e.a);
          const dir = norm(sub(idx.xy(e.b), a));
          const nrm = perp(dir);
          const inward = nrm[0] * (centre[0] - xy[0]) + nrm[1] * (centre[1] - xy[1]) > 0 ? 1 : -1;
          xy = add(add(xy, scale(nrm, inward * 14 * px)), scale(dir, (n * 18 - 10) * px));
        } else xy = add(xy, [(10 + n * 18) * px, -12 * px]);
        const p = at(xy);
        return [{ c, g, x: p.x, y: p.y }];
      })
    : [];

  return (
    <div className="bc-snaps" data-tick={s.camTick}>
      {s.sketch.dimensions.map((d) => {
        const p = at(dimAnchor(idx, d, px, centre));
        const on = s.sel.includes(d.id) || conflicting.has(d.id);
        if (s.dimEdit === d.id) {
          return (
            <DimInput
              key={d.id}
              x={p.x}
              y={p.y}
              label={d.kind === "angle" ? "Angle in degrees" : "Size in mm"}
              value={d.expression}
              onDone={(text) => {
                if (text !== null) s.setDimension(d.id, text);
                s.setDimEdit(null);
              }}
            />
          );
        }
        return (
          <button
            key={d.id}
            type="button"
            className={`bc-dim bc-dim-pill${on ? " bc-on" : ""}${d.driving ? "" : " bc-driven"}`}
            style={{ left: p.x, top: p.y }}
            title={d.driving ? "Double-click to type a size" : "A reference size: it follows the geometry"}
            onClick={(e) => pick(d.id, e)}
            onDoubleClick={() => s.setDimEdit(d.id)}
          >
            {d.driving ? formatDimension(d) : `(${formatDimension(d)})`}
          </button>
        );
      })}
      {glyphs.map(({ c, g, x, y }) => (
        <button
          key={c.id}
          type="button"
          className={`bc-glyph${s.sel.includes(c.id) ? " bc-on" : ""}${conflicting.has(c.id) ? " bc-bad" : ""}${c.suppressed ? " bc-off" : ""}`}
          style={{ left: x, top: y }}
          title={CONSTRAINT_LABEL[c.type]}
          aria-label={`${CONSTRAINT_LABEL[c.type]} constraint`}
          onClick={(e) => pick(c.id, e)}
        >
          {g}
        </button>
      ))}
      {s.ctool && s.pointer && (
        <span className="bc-snap-label bc-tool-tag" aria-hidden="true" style={{ left: s.pointer.x, top: s.pointer.y }}>
          {toolTag(s)}
        </span>
      )}
      {s.cursor && s.cursor.kind !== "free" && (
        <span className="bc-snap-label" style={{ left: at(s.cursor.xy).x, top: at(s.cursor.xy).y }}>
          {SNAP_LABEL[s.cursor.kind]}
        </span>
      )}
    </div>
  );
}

/** The armed constraint's tag by the pointer. Over a line, Horizontal/Vertical says which one that line would get. */
function toolTag(s: SketchSession): string {
  const t = constraintToolById(s.ctool!);
  if (t.id === "horizontalVertical" && s.hover && s.sketch) {
    const k = levelOrUpright(s.sketch, s.hover);
    if (k) return CONSTRAINT_LABEL[k];
  }
  return t.tag;
}

/** The right column while sketching: the sketch's plane and state, its sizes and its constraints. */
export function SketchPanel({ s }: { s: SketchSession }) {
  if (!s.sketch || !s.feature) return null;
  const sk = s.sketch;
  const conflicting = new Set(s.result?.conflicting ?? []);
  const redundant = new Set(s.result?.redundant ?? []);
  const plane = sk.plane.kind === "world" ? `${sk.plane.plane} plane` : "A face";
  const sections: PropsSection[] = [
    {
      id: "sketch",
      title: s.feature.name,
      content: (
        <>
          <PropRow label="On">{plane}</PropRow>
          <NumberField label="Offset" value={sk.plane.offset} step={1} onCommit={(v) => s.setOffset(v)} />
          <PropRow label="State">{s.status}</PropRow>
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
  return <PropsPanel label="Sketch" sections={sections} />;
}
