import type { KeyboardEvent } from "react";
import type { DrawingMark } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { curvePath } from "./views";
import { CENTRE_DASH, MARK_NAMES, markArt, offered, refKey, refTo, targets, type MarkStyle, type Target } from "./marks";

/** The four tools of Fusion's Geometry menu (#563). */
export type MarkTool = "centre-mark" | "centre-pattern" | "centre-line" | "extension";
export const MARK_TOOLS: readonly MarkTool[] = ["centre-mark", "centre-pattern", "centre-line", "extension"];
export const isMarkTool = (t: string | null | undefined): t is MarkTool => !!t && (MARK_TOOLS as readonly string[]).includes(t);

/** What each tool can be put on. */
const PICKS: Record<MarkTool, (t: Target) => boolean> = {
  "centre-mark": (t) => t.kind === "round",
  "centre-pattern": (t) => t.kind === "round" && t.whole,
  "centre-line": (t) => t.kind === "axis" || t.kind === "edge",
  extension: (t) => t.kind === "edge",
};

const mm = (v: number) => String(Math.round(v * 100) / 100);
/** What a target is called: "Hole, 5 mm across", "Edge, 40 mm long". */
export function targetName(t: Target): string {
  if (t.kind === "edge") return `Edge, ${mm(Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]))} mm long`;
  const what = t.hole ? "hole" : t.source.kind === "face" ? "round face" : t.whole ? "circle" : "arc";
  if (t.kind === "axis") return `Axis of a ${what}, ${mm(t.r * 2)} mm across`;
  return `${what[0]!.toUpperCase()}${what.slice(1)}, ${mm(t.r * 2)} mm across`;
}

export interface MarkLayerProps {
  /** The view's id, its picture, and the scale it is drawn at. */
  viewId: string;
  model: ModelView;
  scale: number;
  style: MarkStyle;
  /** This view's marks. */
  marks: DrawingMark[];
  /** The armed tool: the things it can be put on are drawn to point at, tab to and press. */
  tool?: MarkTool | null;
  /** Keys (`refKey`) of what has been picked so far, lit up. */
  picked?: ReadonlySet<string>;
  onPick?: (target: Target) => void;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** Delete on a mark. Left out, marks are only drawn. */
  onDelete?: (id: string) => void;
}

/**
 * A view's marks, and while a mark tool is armed the holes and edges it can go on. Inside the view's own group:
 * paper millimetres from the middle of the view, y down as SVG draws.
 */
export function MarkLayer({ viewId, model, scale, style, marks, tool, picked, onPick, selected, onSelect, onDelete }: MarkLayerProps) {
  const all = targets(model);
  const mid: V2 = [(model.box.min[0] + model.box.max[0]) / 2, (model.box.min[1] + model.box.max[1]) / 2];
  const P = (q: V2): V2 => [(q[0] - mid[0]) * scale, (mid[1] - q[1]) * scale];
  const press = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    fn();
  };
  return (
    <>
      {marks.map((m) => {
        const art = markArt(m, model, scale, style, all);
        if (!art) return null;
        // Paper millimetres with y up become the page's y down.
        const d = art.lines.map(([a, b]) => `M${a[0]} ${-a[1]}L${b[0]} ${-b[1]}`).join("");
        const round = art.curves.map((c) => curvePath(c, 1, [0, 0])).join("");
        return (
          <g
            key={m.id}
            data-mark={m.id}
            className={selected === m.id ? "bc-mark bc-mark-on" : "bc-mark"}
            role="button"
            aria-label={MARK_NAMES[m.kind]}
            aria-pressed={selected === m.id}
            tabIndex={0}
            onFocus={() => onSelect?.(m.id)}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              // Keys on a mark are its own: the view under it must not move or go.
              e.stopPropagation();
              if (onDelete && (e.key === "Delete" || e.key === "Backspace")) {
                e.preventDefault();
                onDelete(m.id);
              }
            }}
          >
            <path className="bc-mark-hit" d={d + round} />
            <path className="bc-mark-line" d={d} />
            {round && <path className="bc-mark-line" d={round} strokeDasharray={CENTRE_DASH.join(" ")} />}
          </g>
        );
      })}
      {tool &&
        onPick &&
        offered(all)
          .filter(PICKS[tool])
          .map((t) => {
            const key = refKey(refTo(viewId, t));
            const on = picked?.has(key);
            const common = {
              className: on ? "bc-mark-pick bc-mark-picked" : "bc-mark-pick",
              role: "button",
              "aria-label": targetName(t),
              "aria-pressed": tool === "centre-pattern" || on ? !!on : undefined,
              tabIndex: 0,
              onClick: () => onPick(t),
              onDoubleClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
              onKeyDown: press(() => onPick(t)),
            } as const;
            if (t.kind === "round") {
              const [x, y] = P(t.c);
              return <circle key={key} {...common} cx={x} cy={y} r={Math.max(t.r * scale, 1.5)} />;
            }
            const [a, b] = [P(t.a), P(t.b)];
            // An axis is picked anywhere across its hole; an edge within a millimetre and a half of it.
            const width = t.kind === "axis" ? Math.max(t.r * 2 * scale, 3) : 3;
            return <line key={key} {...common} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} strokeWidth={width} />;
          })}
    </>
  );
}
