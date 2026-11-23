import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { DrawingDimension } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { curvePath } from "./views";
import { dimArt, dimName, dimPicks, pickKey, type DimArt, type DimContext, type DimPick, type DimStyle } from "./dimensions";
import { targets } from "./marks";

/** How far an arrow key moves a size's text, mm; Shift moves it ten times as far. */
const NUDGE = 1;
/** Half the width of the band an edge is picked by, mm on paper. */
const BAND = 1.5;

const n = (v: number) => String(Math.round(v * 1000) / 1000);
/** Paper millimetres with y up become the page's y down. */
const linesPath = (art: DimArt) =>
  art.lines.map(([a, b]) => `M${n(a[0])} ${n(-a[1])}L${n(b[0])} ${n(-b[1])}`).join("") + art.arcs.map((c) => curvePath(c, 1, [0, 0])).join("");
const arrowsPath = (art: DimArt) => art.arrows.map((t) => t.map((q, i) => `${i ? "L" : "M"}${n(q[0])} ${n(-q[1])}`).join("") + "Z").join("");

/** A dimension's lines, arrowheads and size, in its view's group. */
function Art({ art, size }: { art: DimArt; size: number }) {
  const [x, y] = [art.text.at[0], -art.text.at[1]];
  return (
    <>
      <path className="bc-size-line" d={linesPath(art)} />
      <path className="bc-size-arrow" d={arrowsPath(art)} />
      <text
        className="bc-size-text"
        x={n(x)}
        y={n(y)}
        fontSize={size}
        textAnchor="middle"
        dominantBaseline="central"
        transform={art.text.turn ? `rotate(${n((-art.text.turn * 180) / Math.PI)} ${n(x)} ${n(y)})` : undefined}
      >
        {art.text.text}
      </text>
    </>
  );
}

export interface DimensionLayerProps {
  viewId: string;
  model: ModelView;
  scale: number;
  style: DimStyle;
  /** The drawing's decimal places, and whether the view is an isometric. */
  decimals: number;
  iso?: boolean;
  /** This view's dimensions. */
  dimensions: DrawingDimension[];
  /** Screen pixels per paper millimetre, for dragging a size by its text. */
  zoom: number;
  /** The Dimension tool is armed: edges, circles and points are drawn to point at, tab to and press. */
  picking?: boolean;
  /** Keys (`pickKey`) of what has been picked so far, lit up. */
  picked?: ReadonlySet<string>;
  /** Something is picked already, in any view: the middles of edges are offered too, to measure to. */
  started?: boolean;
  onPick?: (pick: DimPick) => void;
  /** The size being placed, following the pointer. */
  ghost?: Pick<DrawingDimension, "refs" | "across" | "at" | "decimals">;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** A size's text moved, by a drag or the arrow keys. Left out, sizes are only drawn. */
  onMove?: (id: string, at: V2) => void;
  onDelete?: (id: string) => void;
  onMenu?: (id: string, x: number, y: number) => void;
}

/**
 * A view's dimensions (#564), and while the Dimension tool is armed what it can size. Inside the view's own group:
 * paper millimetres from the middle of the view, y down as SVG draws.
 */
export function DimensionLayer({
  viewId,
  model,
  scale,
  style,
  decimals,
  iso,
  dimensions,
  zoom,
  picking,
  picked,
  started,
  onPick,
  ghost,
  selected,
  onSelect,
  onMove,
  onDelete,
  onMenu,
}: DimensionLayerProps) {
  const ctx: DimContext = { view: model, scale, style, decimals, iso, all: targets(model) };
  const mid: V2 = [(model.box.min[0] + model.box.max[0]) / 2, (model.box.min[1] + model.box.max[1]) / 2];
  const P = (q: V2): V2 => [(q[0] - mid[0]) * scale, (mid[1] - q[1]) * scale];
  const [drag, setDrag] = useState<{ id: string; at: V2 } | null>(null);
  const press = useRef<{ id: string; x: number; y: number; at: V2; moved: boolean } | null>(null);
  const down = (e: PointerEvent<SVGGElement>, d: DrawingDimension) => {
    // A press on a size is its own: the sheet under it must not start to move.
    e.stopPropagation();
    if (!onMove || e.button !== 0) return;
    press.current = { id: d.id, x: e.clientX, y: e.clientY, at: d.at, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent<SVGGElement>) => {
    const p = press.current;
    if (!p) return;
    const [dx, dy] = [e.clientX - p.x, e.clientY - p.y];
    if (!p.moved && Math.hypot(dx, dy) < 3) return;
    p.moved = true;
    setDrag({ id: p.id, at: [p.at[0] + dx / zoom, p.at[1] - dy / zoom] });
  };
  const up = (e: PointerEvent<SVGGElement>) => {
    const p = press.current;
    press.current = null;
    e.stopPropagation();
    if (p?.moved && drag && e.type !== "pointercancel") onMove?.(drag.id, drag.at);
    setDrag(null);
  };
  const key = (e: KeyboardEvent, d: DrawingDimension) => {
    // Keys on a size are its own: the view under it must not move or go.
    e.stopPropagation();
    const step = e.shiftKey ? NUDGE * 10 : NUDGE;
    const by: Record<string, V2> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const go = by[e.key];
    if (go && onMove) onMove(d.id, [d.at[0] + go[0], d.at[1] + go[1]]);
    else if (onDelete && (e.key === "Delete" || e.key === "Backspace")) onDelete(d.id);
    else return;
    e.preventDefault();
  };
  const pressKey = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    fn();
  };
  const ghostArt = ghost ? dimArt(ghost, ctx) : undefined;
  return (
    <>
      {dimensions.map((d) => {
        const art = dimArt(drag?.id === d.id ? { ...d, at: drag.at } : d, ctx);
        if (!art) return null;
        return (
          <g
            key={d.id}
            data-dimension={d.id}
            className={selected === d.id ? "bc-size bc-size-on" : "bc-size"}
            role="button"
            aria-label={dimName(art)}
            aria-pressed={selected === d.id}
            tabIndex={0}
            onFocus={() => onSelect?.(d.id)}
            onPointerDown={(e) => down(e, d)}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => key(e, d)}
            onContextMenu={(e) => {
              if (!onMenu) return;
              e.preventDefault();
              e.stopPropagation();
              onSelect?.(d.id);
              onMenu(d.id, e.clientX, e.clientY);
            }}
          >
            <path className="bc-size-hit" d={linesPath(art)} />
            <rect
              className="bc-size-grip"
              x={n(art.text.at[0] - art.text.width / 2 - 1)}
              y={n(-art.text.at[1] - style.text / 2 - 1)}
              width={n(art.text.width + 2)}
              height={n(style.text + 2)}
              transform={art.text.turn ? `rotate(${n((-art.text.turn * 180) / Math.PI)} ${n(art.text.at[0])} ${n(-art.text.at[1])})` : undefined}
            />
            <Art art={art} size={style.text} />
          </g>
        );
      })}
      {ghostArt && (
        <g className="bc-size bc-size-ghost" aria-hidden="true">
          <Art art={ghostArt} size={style.text} />
        </g>
      )}
      {picking &&
        onPick &&
        dimPicks(viewId, model).map((t) => {
          // Until something is picked a click on the middle of an edge means the edge.
          if (!started && t.kind === "point" && t.ref.at === "middle") return null;
          const k = pickKey(t.ref);
          const on = picked?.has(k);
          const common = {
            className: `bc-size-pick${t.kind === "point" ? " bc-size-point" : ""}${on ? " bc-size-picked" : ""}`,
            role: "button",
            "aria-label": t.name,
            "aria-pressed": on ? true : undefined,
            tabIndex: 0,
            onClick: () => onPick(t),
            onDoubleClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
            onKeyDown: pressKey(() => onPick(t)),
          } as const;
          if (t.kind === "point") {
            const [x, y] = P(t.p);
            return <circle key={k} {...common} cx={x} cy={y} r={1.2} />;
          }
          if (t.kind === "round") {
            const [x, y] = P(t.c);
            return <circle key={k} {...common} cx={x} cy={y} r={Math.max(t.r * scale, 1.5)} />;
          }
          // An edge is a band a millimetre and a half each side of it: a bare line has nothing to point at.
          const [a, b] = [P(t.a), P(t.b)];
          const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const [ox, oy] = [(-(b[1] - a[1]) / l) * BAND, ((b[0] - a[0]) / l) * BAND];
          const band = [
            [a[0] + ox, a[1] + oy],
            [b[0] + ox, b[1] + oy],
            [b[0] - ox, b[1] - oy],
            [a[0] - ox, a[1] - oy],
          ];
          return <polygon key={k} {...common} points={band.map((q) => `${n(q[0]!)},${n(q[1]!)}`).join(" ")} />;
        })}
    </>
  );
}
