import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArmedBar,
  Button,
  MenuButton,
  RibbonButton,
  RibbonGroup,
  cx,
  NumberField,
  evaluate,
  isExpression,
  ToolButton,
  Toolbar,
  useNameComplete,
  type MenuEntry,
  type Scope,
} from "@bettercad/ui";
import {
  CONSTRAINT_LABEL,
  SketchIndex,
  add,
  constraintRefs,
  edgesPossible,
  formatDimension,
  norm,
  perp,
  scale,
  sub,
  toSketch,
  toWorld,
  type Constraint,
  type Dimension,
  type Id,
  type Vec2,
} from "@bettercad/sketch";
import { ORIGIN, SNAP_LABEL } from "./snap";
import { loupeBox, loupeHint } from "./loupe";
import { anchorOf, dimensionArt, offsetTo } from "./dimensions";
import {
  CONSTRAINT_TOOLS,
  SKETCH_TOOLS,
  constraintToolById,
  isDrawTool,
  isPointPick,
  levelOrUpright,
  levelOrUprightPoints,
  toolById,
  type ConstraintToolId,
  type SketchToolId,
} from "./tools";
import type { SketchSession } from "./useSketch";

/** Sketch tools whose line icon is also a model tool's: their colour icon is drawn flat. */
const SKETCH_COLOUR: Partial<Record<SketchToolId, string>> = { fillet: "sk-fillet", mirror: "sk-mirror" };

/** The ribbon's Sketch tab (desktop): draw, change, constrain, then Finish sketch, each group with a drop-down. */
export function SketchRibbon({ s }: { s: SketchSession }) {
  const tool = toolById(s.stool);
  const on = (id: SketchToolId) => (s.stool === id || tool.modeOf === id) && !s.ctool;
  const pick = (id: SketchToolId) => s.pickTool(tool.modeOf === id ? s.stool : id);
  const tools = (ids: SketchToolId[]) => SKETCH_TOOLS.filter((t) => ids.includes(t.id));
  const groups: [string, SketchToolId[], SketchToolId[]][] = [
    [
      "Draw",
      ["select", "line", "rectangle", "circle", "arc", "slot", "ellipse", "spline", "polygon", "point", "text"],
      ["line", "rectangle", "circle", "arc", "slot", "spline", "text"],
    ],
    ["Change", ["fillet", "trim", "extend", "offset", "mirror", "project"], ["trim", "offset", "mirror", "project"]],
  ];
  const entry = (t: (typeof SKETCH_TOOLS)[number]): MenuEntry => ({
    id: t.id,
    label: t.label,
    icon: t.icon,
    colour: SKETCH_COLOUR[t.id] ?? true,
    keys: t.key.toUpperCase(),
    onSelect: () => pick(t.id),
  });
  const pinnedConstraints: ConstraintToolId[] = ["coincident", "horizontalVertical", "parallel", "tangent", "equal", "fix"];
  const dim = toolById("dimension");
  return (
    <>
      {groups.map(([label, all, pins]) => (
        <RibbonGroup key={label} label={label} entries={tools(all).map(entry)}>
          {tools(pins).map((t) => (
            <RibbonButton
              key={t.id}
              icon={t.icon}
              colour={SKETCH_COLOUR[t.id] ?? true}
              label={t.label}
              shortcut={t.key.toUpperCase()}
              pressed={on(t.id)}
              onPress={() => pick(t.id)}
            />
          ))}
        </RibbonGroup>
      ))}
      <RibbonGroup
        label="Constrain"
        entries={[
          entry(dim),
          ...CONSTRAINT_TOOLS.map<MenuEntry>((c) => ({
            id: c.id,
            label: c.label,
            icon: "constraint",
            colour: `sk-${c.id}`,
            onSelect: () => s.constrain(c.id),
          })),
        ]}
      >
        <RibbonButton icon={dim.icon} label={dim.label} shortcut={dim.key.toUpperCase()} pressed={on("dimension")} onPress={() => pick("dimension")} />
        {pinnedConstraints.map((id) => {
          const c = constraintToolById(id);
          return (
            <RibbonButton
              key={id}
              icon="constraint"
              colour={`sk-${id}`}
              label={c.label}
              short={id === "horizontalVertical" ? c.tag : undefined}
              pressed={s.ctool === id}
              onPress={() => s.constrain(id)}
            />
          );
        })}
      </RibbonGroup>
      <RibbonGroup label="Finish" entries={[]}>
        <RibbonButton icon="finish" colour={false} done label="Finish sketch" shortcut="Enter" onPress={() => s.finish()} />
      </RibbonGroup>
    </>
  );
}

/**
 * The sketch tool bar and the armed tool's strip, in place of the model bars while a sketch is open. With the ribbon
 * the tools are on its Sketch tab, so only the strip shows.
 */
export function SketchBars({ s, ribbon }: { s: SketchSession; ribbon?: boolean }) {
  const tool = toolById(s.stool);
  const drawing = isDrawTool(s.stool);
  const onFieldKey = (e: ReactKeyboardEvent) => {
    if (e.key !== "Enter") return;
    // The shape is made with what the field holds now, which its own commit has not rendered yet.
    const el = e.target as HTMLInputElement;
    const i = Number(el.closest("[data-field]")?.getAttribute("data-field"));
    let v: number | undefined;
    try {
      v = el.value.trim() ? evaluate(el.value, s.scope) : undefined;
    } catch {
      return;
    }
    const typed = Number.isInteger(i) && v !== undefined && v > 0 ? Object.assign([...s.typed], { [i]: v }) : undefined;
    // Now, not after a timeout: an Esc pressed straight after would clear the shape first.
    s.commitTyped(typed);
  };
  return (
    <>
      {!ribbon && (
        <Toolbar label="Sketch tools">
          {SKETCH_TOOLS.filter((t) => !t.modeOf).map((t) => (
            <ToolButton
              key={t.id}
              icon={t.icon}
              colour={SKETCH_COLOUR[t.id] ?? true}
              label={t.label}
              shortcut={t.key.toUpperCase()}
              pressed={(s.stool === t.id || tool.modeOf === t.id) && !s.ctool}
              showLabel
              // A tool in one of its modes puts down the same as the tool itself.
              onPress={() => s.pickTool(tool.modeOf === t.id ? s.stool : t.id)}
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
      )}
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
                  scope={s.scope}
                  onCommit={(v) => s.setTyped((t) => Object.assign([...t], { [i]: v }))}
                />
              </span>
            ))}
          </span>
        )}
        {s.stool === "fillet" && <NumberField label="Radius" value={s.filletR} min={0.01} scope={s.scope} onCommit={(v) => s.setFilletR(v)} />}
        {s.stool === "offset" && (
          <>
            <NumberField label="Distance" value={s.offsetD} min={0.01} scope={s.scope} onCommit={(v) => s.setOffsetD(v)} />
            <Button label="Both sides" title="Copy to both sides at once" on={s.offsetBoth} onClick={() => s.setOffsetBoth((b) => !b)} />
          </>
        )}
        {s.stool === "mirror" && (
          <span className="bc-sk-modes" role="group" aria-label="Mirror picks">
            <Button
              label={s.sel.length ? `Shapes (${s.sel.length})` : "Shapes"}
              title="Click the shapes to mirror"
              on={s.mirrorStage === "shapes"}
              onClick={() => s.setMirrorStage("shapes")}
            />
            <Button
              label="Mirror line"
              title="Click a line or an axis to mirror the shapes across"
              on={s.mirrorStage === "line"}
              disabled={!s.sel.length}
              onClick={() => s.setMirrorStage("line")}
            />
          </span>
        )}
        {s.stool === "project" && (
          <Button
            label="As construction"
            title="Projected edges guide the sketch without making shapes"
            on={s.projectGuide}
            onClick={() => s.setProjectGuide(!s.projectGuide)}
          />
        )}
        {!s.ctool && (tool.modes ?? []).length > 1 && (
          <span className="bc-sk-modes" role="group" aria-label={`${tool.label} kind`}>
            {tool.modes!.map((m) => (
              <Button key={m.id} label={m.mode ?? m.label} on={s.stool === m.id} onClick={() => s.stool !== m.id && s.pickTool(m.id)} />
            ))}
          </span>
        )}
        {s.stool === "polygon" && (
          <NumberField label="Sides" unit="none" value={s.sides} min={3} max={12} step={1} precision={0} onCommit={(v) => s.setSides(Math.round(v))} />
        )}
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

export const DIM_LABEL: Record<Dimension["kind"], string> = {
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

/** An arrowhead 9 px long and 6 px wide, its tip at `tip`, pointing away from `back` (a pixel behind it). */
function arrowHead(tip: { x: number; y: number }, back: { x: number; y: number }): string {
  let dx = tip.x - back.x;
  let dy = tip.y - back.y;
  const l = Math.hypot(dx, dy) || 1;
  dx /= l;
  dy /= l;
  const bx = tip.x - dx * 9;
  const by = tip.y - dy * 9;
  return `${tip.x},${tip.y} ${bx - dy * 3},${by + dx * 3} ${bx + dy * 3},${by - dx * 3}`;
}

/**
 * Typing a size into a dimension's pill: a number, a sum ("width * 2", "(depth + 3) / 2") or a parameter, offered by
 * name as it is typed. Enter or leaving the field sets it; Esc closes the names first, then (through the Esc stack)
 * cancels.
 */
export function DimInput({
  x,
  y,
  label,
  value,
  scope,
  onDone,
  edges,
}: {
  x: number;
  y: number;
  label: string;
  value: string;
  scope?: Scope;
  onDone: (text: string | null) => void;
  /** A distance to a circle: whether it runs to the edge, and how to switch it (the box opens again after). */
  edges?: { on: boolean; set: (on: boolean) => void };
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const [text, setText] = useState(value);
  const names = useNameComplete(scope, ref, setText);
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
    <span
      className="bc-dim-edit"
      style={{ left: x, top: y }}
      onBlur={(e) => {
        // Moving between the value and the Centres / Edges switch keeps the box open.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) finish(ref.current?.value ?? text);
      }}
    >
      {edges && (
        <span role="group" aria-label="Measure to" className="bc-segmented bc-dim-to">
          {(
            [
              [false, "Centres", "Size between the centres"],
              [true, "Edges", "Size the gap between the edges"],
            ] as const
          ).map(([on, name, title]) => (
            <Button
              key={name}
              label={name}
              title={title}
              size="dense"
              on={edges.on === on}
              // The value keeps the focus, so a click here does not close the box.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                if (edges.on === on) return;
                done.current = true;
                edges.set(on);
                // Still here when the switch was refused: the box stays open as it was.
                queueMicrotask(() => (done.current = false));
              }}
            />
          ))}
        </span>
      )}
      <input
        ref={ref}
        className="bc-dim bc-dim-input"
        style={{ width: `${Math.max(9, text.length + 3)}ch` }}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        value={text}
        {...names.inputProps}
        onChange={(e) => {
          setText(e.currentTarget.value);
          names.update(e.currentTarget.value, e.currentTarget.selectionStart);
        }}
        onKeyDown={(e) => {
          if (names.onKeyDown(e)) return;
          if (e.key === "Enter") finish(e.currentTarget.value);
        }}
      />
      {names.list}
    </span>
  );
}

/** The labels over the sketch: dimension pills (double-click to type a size), constraint marks and the snap label. */
export function SketchLabels({ s }: { s: SketchSession }) {
  const eng = s.engineOf();
  /** A size pill held down: where it was grabbed, and whether it has moved far enough to count as a drag. */
  const grab = useRef<{ id: Id; cx: number; cy: number; x: number; y: number; moved: boolean; offset?: Vec2 } | null>(null);
  /** The click that ends a drag does not pick the size. */
  const dragged = useRef(false);
  if (!s.sketch || !s.frame || !eng) return null;
  const frame = s.frame;
  const px = eng.pixelSize(frame.origin);
  const at = (xy: Vec2) => eng.project(toWorld(frame, xy));
  const idx = new SketchIndex(s.sketch);
  const pts = s.sketch.entities.flatMap((e) => (e.kind === "point" ? [[e.x, e.y] as Vec2] : []));
  const centre: Vec2 = pts.length ? scale(pts.reduce(add, [0, 0] as Vec2), 1 / pts.length) : [0, 0];
  const conflicting = new Set(s.result?.conflicting ?? []);
  const pick = (id: Id, e: ReactMouseEvent) => s.setSel((sel) => (e.shiftKey ? (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]) : [id]));

  // Sizes hide with the palette's Dimensions option, except one being typed into or picked.
  // An offset's sizes are one distance (#266): only the first of them shows.
  const firstOfGroup = new Map<Id, Id>();
  for (const d of s.sketch.dimensions) if (d.group && !firstOfGroup.has(d.group)) firstOfGroup.set(d.group, d.id);
  const dims = s.sketch.dimensions
    .filter((d) => !d.group || firstOfGroup.get(d.group) === d.id || s.dimEdit === d.id || s.sel.includes(d.id))
    .filter((d) => s.options.dimensions || s.dimEdit === d.id || s.sel.includes(d.id))
    .map((d) => ({ d, art: dimensionArt(idx, d, px, centre), on: s.sel.includes(d.id) || conflicting.has(d.id) }));
  // A size being placed follows the pointer until a click puts it down.
  const placing = s.placing ? { d: s.placing.dim, art: dimensionArt(new SketchIndex(s.placing.sketch), s.placing.dim, px, centre) } : null;

  // Dragging a size's pill moves its label, and with it the dimension line, as in Fusion.
  const onGrab = (d: Dimension, e: ReactPointerEvent<HTMLElement>, x: number, y: number) => {
    if (e.button !== 0) return;
    grab.current = { id: d.id, cx: e.clientX, cy: e.clientY, x, y, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onDrag = (d: Dimension, e: ReactPointerEvent<HTMLElement>) => {
    const g = grab.current;
    if (!g || g.id !== d.id) return;
    const dx = e.clientX - g.cx;
    const dy = e.clientY - g.cy;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    const w = eng.rayPlane(g.x + dx, g.y + dy, frame.origin, frame.normal);
    if (!w) return;
    g.moved = true;
    g.offset = offsetTo(idx, d, toSketch(frame, w));
    s.moveLabel(d.id, g.offset);
  };
  const onLetGo = (d: Dimension) => {
    const g = grab.current;
    grab.current = null;
    if (!g || g.id !== d.id || !g.moved || !g.offset) return;
    dragged.current = true;
    s.moveLabel(d.id, g.offset, true);
  };

  // While a constraint or the dimension tool is armed, marks let clicks through to the geometry under them.
  const armed = !!s.ctool || s.stool === "dimension";
  const placed = new Map<string, number>();
  const glyphs = s.showConstraints
    ? s.sketch.constraints.flatMap((c) => {
        const g = GLYPH[c.type];
        const e = idx.get(constraintRefs(c)[c.type === "midpoint" ? 1 : 0]!);
        if (!g || !e) return [];
        // Projected geometry is held where the model puts it; a Fix mark on every point of it is only clutter.
        if (c.type === "fix" && e.projectedFrom) return [];
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
      {(dims.length > 0 || placing) && (
        <svg className="bc-dim-art" aria-hidden="true">
          {[...dims, ...(placing ? [{ ...placing, on: true }] : [])].map(({ d, art, on }) => (
            <g key={d.id} className={cx("bc-dim-mark", on && "bc-on", !d.driving && "bc-driven")}>
              {art.lines.map(([a, b], i) => {
                const p = at(a);
                const q = at(b);
                return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
              })}
              {art.arrows.map(({ tip, dir }, i) => {
                const t = at(tip);
                const back = at(add(tip, scale(dir, -px)));
                return <polygon key={`a${i}`} points={arrowHead(t, back)} />;
              })}
            </g>
          ))}
        </svg>
      )}
      {dims.map(({ d, art, on }) => {
        const p = at(art.text);
        if (s.dimEdit === d.id) {
          return (
            <DimInput
              key={`${d.id}:${!!d.edges}`}
              x={p.x}
              y={p.y}
              label={d.kind === "angle" ? "Angle in degrees" : "Size in mm"}
              value={d.expression}
              scope={s.scope}
              edges={edgesPossible(idx, d) ? { on: !!d.edges, set: (on) => s.setDimensionEdges(d.id, on) } : undefined}
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
            title={
              !d.driving
                ? "A reference size: it follows the geometry. Drag to move it"
                : isExpression(d.expression)
                  ? `= ${d.expression}. Double-click to change it, drag to move it`
                  : "Double-click to type a size, drag to move it"
            }
            onPointerDown={(e) => onGrab(d, e, p.x, p.y)}
            onPointerMove={(e) => onDrag(d, e)}
            onPointerUp={() => onLetGo(d)}
            onPointerCancel={() => onLetGo(d)}
            onClick={(e) => {
              if (dragged.current) {
                dragged.current = false;
                return;
              }
              pick(d.id, e);
            }}
            onDoubleClick={() => s.setDimEdit(d.id)}
          >
            {d.driving ? formatDimension(d) : `(${formatDimension(d)})`}
          </button>
        );
      })}
      {placing &&
        (() => {
          const p = at(placing.art.text);
          return (
            <div
              className="bc-dim bc-dim-pill bc-on bc-placing"
              style={{ left: p.x, top: p.y }}
              aria-label={`${DIM_LABEL[placing.d.kind]} ${formatDimension(placing.d)}. Click to place it`}
            >
              {formatDimension(placing.d)}
            </div>
          );
        })()}
      {glyphs.map(({ c, g, x, y }) => (
        <button
          key={c.id}
          type="button"
          className={`bc-glyph${armed ? " bc-pass" : ""}${s.sel.includes(c.id) ? " bc-on" : ""}${conflicting.has(c.id) ? " bc-bad" : ""}${c.suppressed ? " bc-off" : ""}`}
          style={{ left: x, top: y }}
          title={CONSTRAINT_LABEL[c.type]}
          aria-label={`${CONSTRAINT_LABEL[c.type]} constraint`}
          onClick={(e) => pick(c.id, e)}
        >
          {g}
        </button>
      ))}
      {s.hover === ORIGIN && s.origin && !s.cursor && (
        <span className="bc-snap-label" style={{ left: at(s.origin).x, top: at(s.origin).y }}>
          {SNAP_LABEL.origin}
        </span>
      )}
      {s.ctool && s.pointer && (
        <span className="bc-snap-label bc-tool-tag" aria-hidden="true" style={{ left: s.pointer.x, top: s.pointer.y }}>
          {toolTag(s)}
        </span>
      )}
      {s.loupe && <SketchLoupe s={s} view={eng.size} />}
      {s.cursor && s.cursor.kind !== "free" && (
        <span className="bc-snap-label" style={{ left: at(s.cursor.xy).x, top: at(s.cursor.xy).y }}>
          {s.cursor.label || SNAP_LABEL[s.cursor.kind]}
        </span>
      )}
    </div>
  );
}

/**
 * The armed constraint's tag by the pointer. Over a line, Horizontal/Vertical says which one that line would get;
 * over a second point, which way the two points would line up.
 */
function toolTag(s: SketchSession): string {
  const t = constraintToolById(s.ctool!);
  if (t.id === "horizontalVertical" && s.hover && s.sketch) {
    const first = s.sel.length === 1 && s.sel[0] !== s.hover && isPointPick(s.sketch, s.sel[0]!) ? s.sel[0]! : null;
    const k =
      first && isPointPick(s.sketch, s.hover) ? levelOrUprightPoints(s.sketch, first, s.hover, s.origin ?? undefined) : levelOrUpright(s.sketch, s.hover);
    if (k) return CONSTRAINT_LABEL[k];
  }
  return t.tag;
}

/**
 * The magnifier loupe: the sketch near the pointer, zoomed in, above the pointer (below it near the top of the view).
 * The session draws into its canvas; this places it and says how far it zooms.
 */
/** About where the top bar and the sketch tool bars end, in view pixels. */
const TOOLBARS_BOTTOM = 140;

function SketchLoupe({ s, view }: { s: SketchSession; view: { width: number; height: number } }) {
  const l = s.loupe!;
  // Keep clear of the top bar and the sketch's tool bars, which float over the top of the view.
  const box = loupeBox(l.why === "touch" ? l.pointer : l.anchor, { ...view, top: TOOLBARS_BOTTOM });
  return (
    <div className={cx("bc-loupe", box.below && "bc-below")} style={{ left: box.left, top: box.top }} aria-hidden="true">
      <canvas ref={s.loupeCanvas} />
      <span className="bc-loupe-zoom">{l.zoom}×</span>
      {loupeHint(l.why) && <span className="bc-loupe-hint">{loupeHint(l.why)}</span>}
    </div>
  );
}
