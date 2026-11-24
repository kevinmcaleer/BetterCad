import { useEffect, useId, useRef, useState } from "react";
import type { FootprintDef, FootprintLayer, P2, Pad, PadKind, PadShape, Shape } from "@bettercad/electronics";
import { Button, ESC, NumberField, cx, useEscape } from "@bettercad/ui";
import { Canvas2D, type Canvas2DApi, type Pointer } from "./Canvas2D";
import { readColours, type Colours } from "./colours";
import { padPath, shapeOn } from "./drawBoard";
import {
  LAND_GRID,
  OUTLINE_LAYERS,
  PAD_KINDS,
  PAD_SHAPES,
  addOutline,
  addPad,
  deleteItems,
  hitFootprint,
  isPad,
  itemBox,
  landBox,
  moveItems,
  padsOf,
  setOutline,
  setPadKind,
  setPads,
  shared,
  wrapCourtyard,
  type LandId,
} from "./footprintEdit";
import { fit, snap, toScreen, type View2D } from "./view2d";

type Tool = "select" | "pad" | "line" | "rect" | "circle";
const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "select", label: "Select", hint: "Click a pad or an outline to pick it. Shift-click picks more. Drag to move." },
  { id: "pad", label: "Pad", hint: "Click where the pad's centre goes. It copies the last pad's shape and size." },
  { id: "line", label: "Line", hint: "Click each corner. Double-click, or press Enter, to finish." },
  { id: "rect", label: "Rectangle", hint: "Click one corner, then the opposite one." },
  { id: "circle", label: "Circle", hint: "Click the centre, then the edge." },
];

const LAYER_COLOUR: Record<FootprintLayer, keyof Colours> = { silk: "ec-silk", courtyard: "ec-courtyard", fab: "muted", copper: "ec-copper-top" };
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

export interface FootprintEditorProps {
  footprint: FootprintDef;
  /** The board's mask gap, shown as what a pad gets when it has none of its own. */
  maskRule?: number;
  onChange: (footprint: FootprintDef) => void;
}

/**
 * Change a footprint pad by pad (#627): add, move and delete pads; set each one's number, kind, shape, size, hole,
 * and its own mask and paste openings; and draw the silkscreen, courtyard and fabrication outlines. Sizes are typed
 * in millimetres. Undo and redo are the editor's own, since nothing is saved until the part is.
 */
export default function FootprintEditor({ footprint: fp, maskRule = 0.05, onChange }: FootprintEditorProps) {
  const ids = useId();
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Canvas2DApi>(null);
  const [view, setView] = useState<View2D>({ scale: 30, ox: 160, oy: 140 });
  const [tool, setTool] = useState<Tool>("select");
  const [layer, setLayer] = useState<FootprintLayer>("silk");
  const [picked, setPicked] = useState<LandId[]>([]);
  const [pts, setPts] = useState<P2[]>([]);
  const [hover, setHover] = useState<P2 | null>(null);
  const [past, setPast] = useState<FootprintDef[]>([]);
  const [future, setFuture] = useState<FootprintDef[]>([]);
  const drag = useRef<{ from: P2; start: FootprintDef; moved: boolean } | null>(null);
  const fitted = useRef(false);

  const commit = (next: FootprintDef, from: FootprintDef = fp) => {
    if (next === from) return;
    setPast((p) => [...p.slice(-99), from]);
    setFuture([]);
    onChange(next);
  };
  const undo = () => {
    const last = past[past.length - 1];
    if (!last) return;
    setPast(past.slice(0, -1));
    setFuture([fp, ...future]);
    setPicked([]);
    onChange(last);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast([...past, fp]);
    setPicked([]);
    onChange(next);
  };
  const doFit = () => {
    const size = api.current?.size();
    if (!size || size.w < 10) return false;
    const v = fit(landBox(fp), size, undefined, 28);
    setView({ ...v, scale: Math.min(v.scale, 60) });
    return true;
  };
  useEffect(() => {
    if (!fitted.current) fitted.current = doFit();
  });

  const arm = (t: Tool) => {
    setTool(t);
    setPts([]);
    if (t !== "select") setPicked([]);
  };
  const finishLine = (points: P2[]) => {
    const clean = points.filter((p, i) => i === 0 || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1]);
    if (clean.length >= 2) commit(addOutline(fp, { kind: "line", pts: clean }, layer).fp);
    setPts([]);
  };

  const onDown = (p: Pointer) => {
    const at = snap(p.world, LAND_GRID);
    if (tool === "select") {
      const hit = hitFootprint(fp, p.world, 5 / view.scale)[0];
      if (!hit) {
        setPicked([]);
        return false;
      }
      const next = p.shift ? (picked.includes(hit) ? picked.filter((x) => x !== hit) : [...picked, hit]) : picked.includes(hit) ? picked : [hit];
      setPicked(next);
      drag.current = { from: at, start: fp, moved: false };
      return true;
    }
    if (tool === "pad") {
      const made = addPad(fp, at);
      commit(made.fp);
      setPicked([made.id]);
      return true;
    }
    if (tool === "line") {
      setPts([...pts, at]);
      return true;
    }
    const all = [...pts, at];
    if (all.length < 2) {
      setPts(all);
      return true;
    }
    const [a, b] = all as [P2, P2];
    let shape: Shape | null = null;
    if (tool === "rect" && a[0] !== b[0] && a[1] !== b[1])
      shape = { kind: "rect", x1: Math.min(a[0], b[0]), y1: Math.min(a[1], b[1]), x2: Math.max(a[0], b[0]), y2: Math.max(a[1], b[1]) };
    else if (tool === "circle") {
      const r = r4(Math.hypot(b[0] - a[0], b[1] - a[1]));
      if (r > 0) shape = { kind: "circle", cx: a[0], cy: a[1], r };
    }
    if (shape) commit(addOutline(fp, shape, layer).fp);
    setPts([]);
    return true;
  };
  const onMove = (p: Pointer, dragging: boolean) => {
    if (tool !== "select") {
      setHover(snap(p.world, LAND_GRID));
      return;
    }
    const d = drag.current;
    if (!d || !dragging) return;
    const to = snap(p.world, LAND_GRID);
    const moved = moveItems(d.start, picked, to[0] - d.from[0], to[1] - d.from[1]);
    if (moved !== d.start || d.moved) {
      d.moved = true;
      onChange(moved);
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved && fp !== d.start) {
      setPast((p) => [...p.slice(-99), d.start]);
      setFuture([]);
    }
  };
  const remove = () => {
    if (!picked.length) return;
    commit(deleteItems(fp, picked));
    setPicked([]);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, select, textarea")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove();
    } else if (e.key === "Enter" && tool === "line") {
      e.preventDefault();
      finishLine(pts);
    }
  };
  // One layer at a time: the shape in hand first, then the tool, then the dialog's own Esc.
  useEscape(pts.length > 0, () => setPts([]), ESC.drag);
  useEscape(tool !== "select" && pts.length === 0, () => arm("select"), ESC.overlay);

  const draw = (ctx: CanvasRenderingContext2D, v: View2D, size: { w: number; h: number }) => {
    const c = readColours(host.current);
    ctx.fillStyle = c["ec-pcb-bg"];
    ctx.fillRect(0, 0, size.w, size.h);
    // The origin: where the part is placed and turned from.
    const o = toScreen(v, [0, 0]);
    ctx.strokeStyle = c["ec-pcb-ink"];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(o[0] - 6, o[1]);
    ctx.lineTo(o[0] + 6, o[1]);
    ctx.moveTo(o[0], o[1] - 6);
    ctx.lineTo(o[0], o[1] + 6);
    ctx.stroke();
    const same = (q: P2) => q;
    for (const s of fp.shapes) if (s.layer !== "silk") shapeOn(ctx, v, s, same, 0, false, c[LAYER_COLOUR[s.layer]], c);
    for (const pad of fp.pads) {
      const at: P2 = [pad.x, pad.y];
      if (pad.kind !== "npth") {
        ctx.fillStyle = pad.kind === "smd" ? c["ec-copper-top"] : c["ec-pad"];
        padPath(ctx, v, pad, at, pad.angle ?? 0);
        ctx.fill();
      }
      if (pad.drill) {
        ctx.fillStyle = c["ec-hole"];
        padPath(ctx, v, { ...pad, shape: "oval", w: pad.slot && pad.slot > pad.drill ? pad.slot : pad.drill, h: pad.drill }, at, pad.angle ?? 0);
        ctx.fill();
      }
      const px = Math.min(pad.w, pad.h) * v.scale * 0.6;
      if (pad.number && px >= 7) {
        const q = toScreen(v, at);
        ctx.fillStyle = c["ec-pcb-ink"];
        ctx.font = `${Math.min(px, 13)}px ${c.font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(pad.number, q[0], q[1]);
      }
    }
    for (const s of fp.shapes) if (s.layer === "silk") shapeOn(ctx, v, s, same, 0, false, c["ec-silk"], c);
    // What is picked: boxed, and a pad's mask opening (dashed) and paste opening (dotted) drawn to size.
    ctx.lineWidth = 1;
    for (const id of picked) {
      const b = itemBox(fp, id);
      if (!b) continue;
      const a = toScreen(v, [b.x1, b.y2]);
      const z = toScreen(v, [b.x2, b.y1]);
      ctx.strokeStyle = c.accent;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(a[0] - 4, a[1] - 4, z[0] - a[0] + 8, z[1] - a[1] + 8);
      const pad = isPad(id) ? fp.pads[Number(id.slice(1))] : undefined;
      if (!pad) continue;
      ctx.strokeStyle = c["ec-mark"];
      padPath(
        ctx,
        v,
        pad.kind === "npth" ? { ...pad, shape: "circle", w: pad.drill ?? pad.w, h: pad.drill ?? pad.h } : pad,
        [pad.x, pad.y],
        pad.angle ?? 0,
        pad.maskMargin ?? maskRule,
      );
      ctx.stroke();
      if (pad.kind === "smd" && !pad.noPaste && pad.pasteMargin) {
        ctx.setLineDash([1, 3]);
        ctx.strokeStyle = c["ec-pcb-ink"];
        padPath(ctx, v, pad, [pad.x, pad.y], pad.angle ?? 0, pad.pasteMargin);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    // The shape in hand.
    if (tool !== "select" && hover) {
      const h = toScreen(v, hover);
      ctx.strokeStyle = c.accent;
      ctx.fillStyle = c.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const first = pts[0] && toScreen(v, pts[0]);
      if (tool === "line" && pts.length) {
        pts.forEach((q, i) => {
          const s = toScreen(v, q);
          if (i) ctx.lineTo(s[0], s[1]);
          else ctx.moveTo(s[0], s[1]);
        });
        ctx.lineTo(h[0], h[1]);
      } else if (tool === "rect" && first) ctx.rect(Math.min(first[0], h[0]), Math.min(first[1], h[1]), Math.abs(h[0] - first[0]), Math.abs(h[1] - first[1]));
      else if (tool === "circle" && first) ctx.arc(first[0], first[1], Math.hypot(h[0] - first[0], h[1] - first[1]), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillRect(h[0] - 2, h[1] - 2, 4, 4);
    }
  };

  const pads = padsOf(fp, picked);
  const padIds = picked.filter(isPad);
  const one = picked.length === 1 ? picked[0]! : null;
  const shape = one && !isPad(one) ? fp.shapes[Number(one.slice(1))] : undefined;
  const set = (patch: Partial<Record<keyof Pad, unknown>>) => commit(setPads(fp, padIds, patch));
  const kind = shared(pads, "kind", "smd");
  const padShape = shared(pads, "shape", "rect");
  const allSmd = pads.length > 0 && pads.every((p) => p.kind === "smd");
  const holes = pads.length > 0 && pads.every((p) => p.kind !== "smd");
  const ownMask = pads.length > 0 && pads.every((p) => p.maskMargin !== undefined);
  const paste = pads.every((p) => p.noPaste) ? "none" : pads.every((p) => !p.noPaste && p.pasteMargin !== undefined) ? "own" : "pad";
  const hint = TOOLS.find((t) => t.id === tool)!.hint;
  const nPads = fp.pads.length;
  const nShapes = fp.shapes.length;
  const label = `Footprint drawing: ${nPads} ${nPads === 1 ? "pad" : "pads"}, ${nShapes} ${nShapes === 1 ? "outline" : "outlines"}`;
  const size = (key: "w" | "h" | "drill" | "slot", text: string, min: number) => (
    <NumberField label={text} unit="mm" value={shared(pads, key, 0)} min={min} max={50} step={0.05} precision={3} onCommit={(v) => set({ [key]: v })} />
  );

  return (
    <div className="bc-ec-symed" ref={host} onKeyDown={onKey}>
      <div className="bc-ec-symed-tools" role="toolbar" aria-label="Footprint tools">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className={cx("bc-ec-switch-item", tool === t.id && "bc-on")} aria-pressed={tool === t.id} onClick={() => arm(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="bc-ec-symed-tools">
        <Button size="dense" variant="secondary" icon="undo" label="Undo" disabled={!past.length} onClick={undo} />
        <Button size="dense" variant="secondary" icon="redo" label="Redo" disabled={!future.length} onClick={redo} />
        <Button size="dense" variant="secondary" icon="trash" label="Delete" disabled={!picked.length} onClick={remove} />
        <Button size="dense" variant="secondary" icon="frame" label="Fit" onClick={doFit} />
        <Button size="dense" variant="secondary" label="Wrap a courtyard round it" disabled={!nPads} onClick={() => commit(wrapCourtyard(fp))} />
        {tool === "line" && pts.length >= 2 && <Button size="dense" variant="primary" label="Finish the line" onClick={() => finishLine(pts)} />}
      </div>
      <div className="bc-ec-symed-canvas">
        <Canvas2D
          label={label}
          view={view}
          onView={setView}
          draw={draw}
          drawKey={[fp, picked, pts, hover, tool, maskRule]}
          cursor={tool === "select" ? "default" : "crosshair"}
          api={api}
          onDown={onDown}
          onMove={onMove}
          onUp={onUp}
          onDouble={() => tool === "line" && finishLine(pts)}
        />
      </div>
      <p className="bc-note" role="status">
        {hint}
      </p>
      {(tool === "line" || tool === "rect" || tool === "circle") && (
        <>
          <label className="bc-field-label" htmlFor={`${ids}on`}>
            Draw on
          </label>
          <select id={`${ids}on`} className="bc-select" value={layer} onChange={(e) => setLayer(e.target.value as FootprintLayer)}>
            {OUTLINE_LAYERS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </>
      )}
      {pads.length > 0 && pads.length === picked.length && (
        <fieldset className="bc-ec-symed-props">
          <legend>{pads.length === 1 ? "Pad" : `${pads.length} pads`}</legend>
          <div className="bc-ec-editor-pair">
            {pads.length === 1 && pads[0]!.kind !== "npth" && (
              <div>
                <label className="bc-field-label" htmlFor={`${ids}num`}>
                  Number
                </label>
                <input id={`${ids}num`} className="bc-text" value={pads[0]!.number} onChange={(e) => set({ number: e.target.value.trim() })} />
              </div>
            )}
            <div>
              <label className="bc-field-label" htmlFor={`${ids}kind`}>
                Kind
              </label>
              <select id={`${ids}kind`} className="bc-select" value={kind ?? ""} onChange={(e) => commit(setPadKind(fp, padIds, e.target.value as PadKind))}>
                {kind === null && <option value="">Mixed</option>}
                {PAD_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="bc-field-label" htmlFor={`${ids}shape`}>
            Shape
          </label>
          <select
            id={`${ids}shape`}
            className="bc-select"
            value={padShape ?? ""}
            onChange={(e) => set({ shape: e.target.value as PadShape, round: e.target.value === "roundrect" ? 0.25 : undefined })}
          >
            {padShape === null && <option value="">Mixed</option>}
            {PAD_SHAPES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          {pads.length === 1 && (
            <div className="bc-ec-editor-sizes">
              <NumberField label="X" unit="mm" value={pads[0]!.x} min={-200} max={200} step={0.05} precision={3} onCommit={(x) => set({ x })} />
              <NumberField label="Y" unit="mm" value={pads[0]!.y} min={-200} max={200} step={0.05} precision={3} onCommit={(y) => set({ y })} />
            </div>
          )}
          <div className="bc-ec-editor-sizes">
            {size("w", "Width", 0.05)}
            {size("h", "Height", 0.05)}
            <NumberField
              label="Turned"
              unit="°"
              value={shared(pads, "angle", 0)}
              min={-360}
              max={360}
              step={45}
              precision={1}
              onCommit={(angle) => set({ angle: angle || undefined })}
            />
            {padShape === "roundrect" && (
              <NumberField
                label="Corner rounding"
                unit="%"
                value={(() => {
                  const r = shared(pads, "round", 0.25);
                  return r === null ? null : Math.round(r * 100);
                })()}
                min={0}
                max={50}
                step={5}
                precision={0}
                onCommit={(v) => set({ round: v / 100 })}
              />
            )}
            {holes && size("drill", "Hole", 0.1)}
            {holes && (
              <NumberField
                label="Slot length"
                unit="mm"
                value={shared(pads, "slot", 0)}
                min={0}
                max={50}
                step={0.05}
                precision={3}
                onCommit={(slot) => set({ slot: slot || undefined })}
              />
            )}
          </div>
          <div className="bc-ec-editor-pair">
            <div>
              <label className="bc-field-label" htmlFor={`${ids}mask`}>
                Mask opening
              </label>
              <select
                id={`${ids}mask`}
                className="bc-select"
                value={ownMask ? "own" : "rule"}
                onChange={(e) => set({ maskMargin: e.target.value === "own" ? (pads[0]!.maskMargin ?? maskRule) : undefined })}
              >
                <option value="rule">The board's rule</option>
                <option value="own">Its own gap</option>
              </select>
            </div>
            {ownMask && (
              <NumberField
                label="Mask gap"
                unit="mm"
                value={shared(pads, "maskMargin", 0)}
                min={-1}
                max={2}
                step={0.01}
                precision={3}
                onCommit={(maskMargin) => set({ maskMargin })}
              />
            )}
          </div>
          {allSmd && (
            <div className="bc-ec-editor-pair">
              <div>
                <label className="bc-field-label" htmlFor={`${ids}paste`}>
                  Solder paste
                </label>
                <select
                  id={`${ids}paste`}
                  className="bc-select"
                  value={paste}
                  onChange={(e) => {
                    const how = e.target.value;
                    set({ noPaste: how === "none" ? true : undefined, pasteMargin: how === "own" ? (pads[0]!.pasteMargin ?? 0) : undefined });
                  }}
                >
                  <option value="pad">The pad's size</option>
                  <option value="own">Its own gap</option>
                  <option value="none">None</option>
                </select>
              </div>
              {paste === "own" && (
                <NumberField
                  label="Paste gap"
                  unit="mm"
                  value={shared(pads, "pasteMargin", 0)}
                  min={-5}
                  max={1}
                  step={0.01}
                  precision={3}
                  onCommit={(pasteMargin) => set({ pasteMargin })}
                />
              )}
            </div>
          )}
          <p className="bc-note">
            A gap is how far the opening sits outside the pad all round. Below zero, it sits inside.
            {ownMask ? "" : ` The board's rule opens the mask ${maskRule} mm past the pad unless the board says otherwise.`}
          </p>
        </fieldset>
      )}
      {shape && one && (
        <fieldset className="bc-ec-symed-props">
          <legend>
            {shape.kind === "rect" ? "Rectangle" : shape.kind === "circle" ? "Circle" : shape.kind === "arc" ? "Arc" : shape.kind === "text" ? "Text" : "Line"}
          </legend>
          <label className="bc-field-label" htmlFor={`${ids}layer`}>
            Layer
          </label>
          <select id={`${ids}layer`} className="bc-select" value={shape.layer} onChange={(e) => commit(setOutline(fp, one, { layer: e.target.value }))}>
            {OUTLINE_LAYERS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
            {shape.layer === "copper" && <option value="copper">Copper</option>}
          </select>
          {shape.kind !== "text" && (
            <NumberField
              label="Line width"
              unit="mm"
              value={shape.width ?? 0.12}
              min={0.01}
              max={5}
              step={0.01}
              precision={3}
              onCommit={(width) => commit(setOutline(fp, one, { width }))}
            />
          )}
          {shape.kind === "circle" && (
            <NumberField
              label="Radius"
              unit="mm"
              value={shape.r}
              min={0.05}
              max={100}
              step={0.05}
              precision={3}
              onCommit={(r) => commit(setOutline(fp, one, { r }))}
            />
          )}
        </fieldset>
      )}
    </div>
  );
}
