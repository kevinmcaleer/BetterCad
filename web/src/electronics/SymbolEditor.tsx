import { useEffect, useId, useMemo, useRef, useState } from "react";
import { PIN_TYPES, type P2, type PinType, type Shape, type SymbolDef } from "@bettercad/electronics";
import { Button, ESC, NumberField, cx, useEscape } from "@bettercad/ui";
import { Canvas2D, type Canvas2DApi, type Pointer } from "./Canvas2D";
import { readColours } from "./colours";
import { drawSymbol } from "./drawSchematic";
import { symbolBox } from "./hit";
import {
  DRAW_GRID,
  PIN_GRID,
  SIDES,
  addPin,
  addShape,
  arcFrom,
  copyUnitDrawing,
  deleteItems,
  hitSymbol,
  isPin,
  itemBox,
  moveItems,
  onUnit,
  setPin,
  setPinSide,
  setShape,
  setUnits,
  sideOf,
  unitName,
  type ItemId,
  type PinSide,
} from "./symbolEdit";
import { fit, snap, toScreen, type View2D } from "./view2d";

type Tool = "select" | "line" | "rect" | "circle" | "arc" | "text" | "pin";
const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "select", label: "Select", hint: "Click a line or a pin to pick it. Drag to move it." },
  { id: "pin", label: "Pin", hint: "Click where the wire joins the pin." },
  { id: "line", label: "Line", hint: "Click each corner. Double-click, or press Enter, to finish." },
  { id: "rect", label: "Rectangle", hint: "Click one corner, then the opposite one." },
  { id: "circle", label: "Circle", hint: "Click the centre, then the edge." },
  { id: "arc", label: "Arc", hint: "Click the centre, where the arc starts, then where it ends. It runs anticlockwise." },
  { id: "text", label: "Text", hint: "Click where the text starts." },
];

export interface SymbolEditorProps {
  symbol: SymbolDef;
  onChange: (symbol: SymbolDef) => void;
}

/**
 * Draw a symbol by hand (#626): lines, rectangles, circles, arcs and text, and pins with a number, a name, what they
 * do and a side, on the schematic's own canvas. A symbol can have several units, each with its own drawing and pins.
 * Undo and redo are the editor's own, since nothing is saved until the part is.
 */
export default function SymbolEditor({ symbol, onChange }: SymbolEditorProps) {
  const ids = useId();
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Canvas2DApi>(null);
  const [view, setView] = useState<View2D>({ scale: 8, ox: 160, oy: 140 });
  const [tool, setTool] = useState<Tool>("select");
  const [unit, setUnit] = useState(1);
  const [picked, setPicked] = useState<ItemId[]>([]);
  const [pts, setPts] = useState<P2[]>([]);
  const [hover, setHover] = useState<P2 | null>(null);
  const [side, setSide] = useState<PinSide>("left");
  const [past, setPast] = useState<SymbolDef[]>([]);
  const [future, setFuture] = useState<SymbolDef[]>([]);
  const drag = useRef<{ from: P2; start: SymbolDef; moved: boolean } | null>(null);
  const fitted = useRef(false);

  const shownUnit = Math.min(unit, Math.max(1, symbol.units));
  const commit = (next: SymbolDef, from: SymbolDef = symbol) => {
    if (next === from) return;
    setPast((p) => [...p.slice(-99), from]);
    setFuture([]);
    onChange(next);
  };
  const undo = () => {
    const last = past[past.length - 1];
    if (!last) return;
    setPast(past.slice(0, -1));
    setFuture([symbol, ...future]);
    setPicked([]);
    onChange(last);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast([...past, symbol]);
    setPicked([]);
    onChange(next);
  };

  const doFit = () => {
    const size = api.current?.size();
    if (!size || size.w < 10) return false;
    const v = fit(symbolBox(symbol), size, undefined, 28);
    setView({ ...v, scale: Math.min(v.scale, 14) });
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
  const grid = tool === "pin" ? PIN_GRID : DRAW_GRID;
  const finishLine = (points: P2[]) => {
    const clean = points.filter((p, i) => i === 0 || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1]);
    if (clean.length >= 2) {
      const made = addShape(symbol, { kind: "line", pts: clean }, shownUnit);
      commit(made.def);
    }
    setPts([]);
  };

  const onDown = (p: Pointer) => {
    const at = snap(p.world, grid);
    if (tool === "select") {
      const hit = hitSymbol(symbol, shownUnit, p.world, 6 / view.scale)[0];
      if (!hit) {
        setPicked([]);
        return false;
      }
      const next = p.shift ? (picked.includes(hit) ? picked.filter((x) => x !== hit) : [...picked, hit]) : picked.includes(hit) ? picked : [hit];
      setPicked(next);
      drag.current = { from: snap(p.world, DRAW_GRID), start: symbol, moved: false };
      return true;
    }
    if (tool === "pin") {
      const made = addPin(symbol, at, side, shownUnit);
      commit(made.def);
      setPicked([made.id]);
      return true;
    }
    if (tool === "text") {
      const made = addShape(symbol, { kind: "text", x: at[0], y: at[1], text: "Text", size: 1.27 }, shownUnit);
      commit(made.def);
      setPicked([made.id]);
      setTool("select");
      return true;
    }
    if (tool === "line") {
      setPts([...pts, at]);
      return true;
    }
    const all = [...pts, at];
    let shape: Shape | null = null;
    if (tool === "rect" && all.length === 2) {
      const [a, b] = all as [P2, P2];
      if (a[0] !== b[0] && a[1] !== b[1])
        shape = { kind: "rect", x1: Math.min(a[0], b[0]), y1: Math.min(a[1], b[1]), x2: Math.max(a[0], b[0]), y2: Math.max(a[1], b[1]), fill: true };
    } else if (tool === "circle" && all.length === 2) {
      const r = Math.round(Math.hypot(all[1]![0] - all[0]![0], all[1]![1] - all[0]![1]) * 1e4) / 1e4;
      if (r > 0) shape = { kind: "circle", cx: all[0]![0], cy: all[0]![1], r };
    } else if (tool === "arc" && all.length === 3) shape = arcFrom(all[0]!, all[1]!, all[2]!);
    const needs = tool === "arc" ? 3 : 2;
    if (all.length < needs) {
      setPts(all);
      return true;
    }
    if (shape) commit(addShape(symbol, shape, shownUnit).def);
    setPts([]);
    return true;
  };
  const onMove = (p: Pointer, dragging: boolean) => {
    if (tool !== "select") {
      setHover(snap(p.world, grid));
      return;
    }
    const d = drag.current;
    if (!d || !dragging) return;
    // Pins keep to their own grid, so a drag that has a pin in it moves by whole steps.
    const step = picked.some(isPin) ? PIN_GRID : DRAW_GRID;
    const to = snap(p.world, step);
    const from = snap(d.from, step);
    const moved = moveItems(d.start, picked, to[0] - from[0], to[1] - from[1]);
    if (moved !== d.start || d.moved) {
      d.moved = true;
      onChange(moved);
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved && symbol !== d.start) {
      setPast((p) => [...p.slice(-99), d.start]);
      setFuture([]);
    }
  };
  const remove = () => {
    if (!picked.length) return;
    commit(deleteItems(symbol, picked));
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
    // The grid, as dots at the pins' pitch, and a cross at the symbol's own origin.
    const step = PIN_GRID * v.scale;
    if (step >= 6) {
      ctx.fillStyle = c.line;
      for (let x = v.ox % step; x < size.w; x += step) for (let y = v.oy % step; y < size.h; y += step) ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    const o = toScreen(v, [0, 0]);
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(o[0] - 5, o[1]);
    ctx.lineTo(o[0] + 5, o[1]);
    ctx.moveTo(o[0], o[1] - 5);
    ctx.lineTo(o[0], o[1] + 5);
    ctx.stroke();
    drawSymbol(ctx, v, symbol, { x: 0, y: 0, rot: 0, unit: shownUnit }, c, {});
    // What is picked, boxed.
    ctx.strokeStyle = c.accent;
    ctx.setLineDash([4, 3]);
    for (const id of picked) {
      const b = itemBox(symbol, id);
      if (!b) continue;
      const a = toScreen(v, [b.x1, b.y2]);
      const z = toScreen(v, [b.x2, b.y1]);
      ctx.strokeRect(a[0] - 4, a[1] - 4, z[0] - a[0] + 8, z[1] - a[1] + 8);
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
      else if ((tool === "circle" || tool === "arc") && first) {
        const second = pts[1] && toScreen(v, pts[1]);
        const r = Math.hypot((second ?? h)[0] - first[0], (second ?? h)[1] - first[1]);
        if (tool === "arc" && second) {
          // Canvas y runs down, so anticlockwise on the drawing is "counterclockwise" here with the angles flipped.
          ctx.arc(first[0], first[1], r, Math.atan2(second[1] - first[1], second[0] - first[0]), Math.atan2(h[1] - first[1], h[0] - first[0]), true);
        } else ctx.arc(first[0], first[1], r, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.fillRect(h[0] - 2, h[1] - 2, 4, 4);
    }
  };

  const one = picked.length === 1 ? picked[0]! : null;
  const pin = one && isPin(one) ? symbol.pins[Number(one.slice(1))] : undefined;
  const shape = one && !isPin(one) ? symbol.shapes[Number(one.slice(1))] : undefined;
  const hint = TOOLS.find((t) => t.id === tool)!.hint;
  const counts = useMemo(
    () => ({ pins: symbol.pins.filter((p) => onUnit(symbol, p, shownUnit)).length, shapes: symbol.shapes.filter((s) => onUnit(symbol, s, shownUnit)).length }),
    [symbol, shownUnit],
  );
  const unitHasDrawing = (u: number) => symbol.shapes.some((s) => s.unit === u);
  const label = `Symbol drawing${symbol.units > 1 ? `, unit ${unitName(shownUnit)}` : ""}: ${counts.pins} ${counts.pins === 1 ? "pin" : "pins"}, ${counts.shapes} ${counts.shapes === 1 ? "shape" : "shapes"}`;

  return (
    <div className="bc-ec-symed" ref={host} onKeyDown={onKey}>
      <div className="bc-ec-symed-tools" role="toolbar" aria-label="Symbol tools">
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
        {tool === "line" && pts.length >= 2 && <Button size="dense" variant="primary" label="Finish the line" onClick={() => finishLine(pts)} />}
      </div>
      <div className="bc-ec-symed-canvas">
        <Canvas2D
          label={label}
          view={view}
          onView={setView}
          draw={draw}
          drawKey={[symbol, picked, pts, hover, tool, shownUnit]}
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
      <div className="bc-ec-editor-pair">
        <div>
          <NumberField
            label="Units"
            unit="none"
            value={symbol.units}
            min={1}
            max={26}
            step={1}
            precision={0}
            onCommit={(n) => {
              commit(setUnits(symbol, n));
              setPicked([]);
              setUnit((u) => Math.min(u, Math.max(1, Math.round(n))));
            }}
          />
        </div>
        {symbol.units > 1 && (
          <div>
            <label className="bc-field-label" htmlFor={`${ids}unit`}>
              Showing
            </label>
            <select
              id={`${ids}unit`}
              className="bc-select"
              value={shownUnit}
              onChange={(e) => {
                setUnit(Number(e.target.value));
                setPicked([]);
                setPts([]);
              }}
            >
              {Array.from({ length: symbol.units }, (_, i) => (
                <option key={i} value={i + 1}>
                  Unit {unitName(i + 1)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {symbol.units > 1 && <p className="bc-note">A part with several units, like four gates in one chip, places one unit at a time on the schematic.</p>}
      {symbol.units > 1 && shownUnit > 1 && !unitHasDrawing(shownUnit) && unitHasDrawing(1) && (
        <Button size="dense" variant="secondary" label="Copy unit A's drawing here" onClick={() => commit(copyUnitDrawing(symbol, 1, shownUnit))} />
      )}
      {tool === "pin" && (
        <>
          <label className="bc-field-label" htmlFor={`${ids}newside`}>
            New pins go on the
          </label>
          <select id={`${ids}newside`} className="bc-select" value={side} onChange={(e) => setSide(e.target.value as PinSide)}>
            {SIDES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </>
      )}
      {pin && one && (
        <fieldset className="bc-ec-symed-props">
          <legend>Pin</legend>
          <div className="bc-ec-editor-pair">
            <div>
              <label className="bc-field-label" htmlFor={`${ids}num`}>
                Number
              </label>
              <input id={`${ids}num`} className="bc-text" value={pin.number} onChange={(e) => commit(setPin(symbol, one, { number: e.target.value.trim() }))} />
            </div>
            <div>
              <label className="bc-field-label" htmlFor={`${ids}name`}>
                Name
              </label>
              <input id={`${ids}name`} className="bc-text" value={pin.name} onChange={(e) => commit(setPin(symbol, one, { name: e.target.value }))} />
            </div>
          </div>
          <div className="bc-ec-editor-pair">
            <div>
              <label className="bc-field-label" htmlFor={`${ids}type`}>
                What it does
              </label>
              <select
                id={`${ids}type`}
                className="bc-select"
                value={pin.type}
                onChange={(e) => commit(setPin(symbol, one, { type: e.target.value as PinType }))}
              >
                {PIN_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="bc-field-label" htmlFor={`${ids}side`}>
                Side
              </label>
              <select id={`${ids}side`} className="bc-select" value={sideOf(pin)} onChange={(e) => commit(setPinSide(symbol, one, e.target.value as PinSide))}>
                {SIDES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <NumberField
            label="Length"
            unit="mm"
            value={pin.length}
            min={0}
            max={12.7}
            step={1.27}
            precision={2}
            onCommit={(length) => commit(setPin(symbol, one, { length }))}
          />
        </fieldset>
      )}
      {shape && one && (
        <fieldset className="bc-ec-symed-props">
          <legend>
            {shape.kind === "text" ? "Text" : shape.kind === "rect" ? "Rectangle" : shape.kind === "circle" ? "Circle" : shape.kind === "arc" ? "Arc" : "Line"}
          </legend>
          {shape.kind === "text" && (
            <>
              <label className="bc-field-label" htmlFor={`${ids}text`}>
                Text
              </label>
              <input id={`${ids}text`} className="bc-text" value={shape.text} onChange={(e) => commit(setShape(symbol, one, { text: e.target.value }))} />
              <NumberField
                label="Height"
                unit="mm"
                value={shape.size}
                min={0.5}
                max={10}
                step={0.25}
                precision={2}
                onCommit={(size) => commit(setShape(symbol, one, { size }))}
              />
            </>
          )}
          {(shape.kind === "rect" || shape.kind === "circle" || (shape.kind === "line" && shape.pts.length > 2)) && (
            <label className="bc-check">
              <input type="checkbox" checked={!!shape.fill} onChange={(e) => commit(setShape(symbol, one, { fill: e.target.checked }))} />
              Filled
            </label>
          )}
          {shape.kind === "circle" && (
            <NumberField
              label="Radius"
              unit="mm"
              value={shape.r}
              min={0.1}
              max={100}
              step={0.635}
              precision={3}
              onCommit={(r) => commit(setShape(symbol, one, { r }))}
            />
          )}
        </fieldset>
      )}
    </div>
  );
}
