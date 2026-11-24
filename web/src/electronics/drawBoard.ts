import {
  outlinePoints,
  packageOf,
  placeOnBoard,
  type Air,
  type BoardPad,
  type CopperLayer,
  type ElectronicsDesign,
  type P2,
  type Shape,
  type Side,
} from "@bettercad/electronics";
import type { PourFill, PourShape } from "@bettercad/electronics/pcb/pour";
import type { Colours } from "./colours";
import { rubber } from "./drawSchematic";
import { toScreen, type View2D } from "./view2d";

/** The layers the Layers card lists. */
export type LayerId = "top" | "bottom" | "silk-top" | "silk-bottom" | "courtyard" | "edge" | "holes" | "ratsnest";
export const LAYERS: { id: LayerId; label: string; colour: keyof Colours; copper?: CopperLayer }[] = [
  { id: "top", label: "Top copper", colour: "ec-copper-top", copper: "top" },
  { id: "bottom", label: "Bottom copper", colour: "ec-copper-bottom", copper: "bottom" },
  { id: "silk-top", label: "Top silkscreen", colour: "ec-silk" },
  { id: "silk-bottom", label: "Bottom silkscreen", colour: "ec-silk-far" },
  { id: "courtyard", label: "Part outlines", colour: "ec-courtyard" },
  { id: "edge", label: "Board edge", colour: "ec-edge" },
  { id: "holes", label: "Holes", colour: "ec-pad" },
  { id: "ratsnest", label: "Unrouted lines", colour: "ec-pcb-ink" },
];

export interface BoardLook {
  selected: Set<string>;
  hover?: string | null;
  hidden: Set<LayerId>;
  /** The copper layer being worked on, drawn on top. */
  active: CopperLayer;
  /** A net to light up everywhere. */
  net?: string | null;
  pads: BoardPad[];
  air: Air[];
  /** Rules check markers: a point and the distance found, mm. */
  marks?: { at: P2; text?: string }[];
  ghost?: {
    track?: { pts: P2[]; width: number; layer: CopperLayer; blocked?: boolean };
    placements?: { part: string; x: number; y: number; rot: number; side: Side }[];
  };
  box?: [P2, P2] | null;
  /** The pours as they fill: what to paint and the islands to leave out. */
  pours?: { shape: PourShape; fill: PourFill }[];
  /** An area being drawn, corner by corner. */
  area?: P2[];
}

let scratch: HTMLCanvasElement | null = null;

/**
 * Paints a pour the way a Gerber file will: the area, cut to the board; rings round its own pads knocked out; spokes
 * laid back; then everything it keeps clear of knocked out. It is drawn apart and laid on the board, so knocking out
 * never rubs out what is underneath.
 */
function paintPour(
  ctx: CanvasRenderingContext2D,
  v: View2D,
  size: { w: number; h: number },
  { shape, fill }: { shape: PourShape; fill: PourFill },
  colour: string,
  alpha: number,
) {
  if (typeof document === "undefined") return;
  scratch ??= document.createElement("canvas");
  const dpr = ctx.canvas.width / Math.max(1, size.w);
  if (scratch.width !== ctx.canvas.width || scratch.height !== ctx.canvas.height) {
    scratch.width = ctx.canvas.width;
    scratch.height = ctx.canvas.height;
  }
  const o = scratch.getContext("2d");
  if (!o) return;
  o.setTransform(dpr, 0, 0, dpr, 0, 0);
  o.globalCompositeOperation = "source-over";
  o.clearRect(0, 0, size.w, size.h);
  o.save();
  o.beginPath();
  for (const loop of shape.board)
    loop.forEach((p, i) => {
      const s = toScreen(v, p);
      if (i) o.lineTo(s[0], s[1]);
      else o.moveTo(s[0], s[1]);
    });
  o.clip("evenodd");
  o.fillStyle = colour;
  o.strokeStyle = colour;
  o.lineJoin = "round";
  path(o, v, shape.outline, true);
  o.fill();
  const knock = (k: PourShape["knocks"][number]) => {
    const r = (k.r + k.reach) * v.scale;
    if (k.pts.length === 1) {
      const s = toScreen(v, k.pts[0]!);
      o.beginPath();
      o.arc(s[0], s[1], r, 0, Math.PI * 2);
      o.fill();
      return;
    }
    path(o, v, k.pts, k.pts.length > 2);
    if (k.pts.length > 2) o.fill();
    if (r > 0) {
      o.lineWidth = r * 2;
      o.lineCap = "round";
      o.stroke();
    }
  };
  o.globalCompositeOperation = "destination-out";
  shape.rings.forEach(knock);
  o.globalCompositeOperation = "source-over";
  o.lineCap = "butt";
  for (const s of shape.spokes) {
    o.lineWidth = Math.max(1, s.width * v.scale);
    path(o, v, [s.a, s.b]);
    o.stroke();
  }
  o.globalCompositeOperation = "destination-out";
  shape.knocks.forEach(knock);
  for (const [x, y, w, h] of fill.islands) {
    const s = toScreen(v, [x, y + h]);
    o.fillRect(s[0], s[1], w * v.scale, h * v.scale);
  }
  o.restore();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

function path(ctx: CanvasRenderingContext2D, v: View2D, pts: P2[], close = false) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = toScreen(v, p);
    if (i) ctx.lineTo(s[0], s[1]);
    else ctx.moveTo(s[0], s[1]);
  });
  if (close) ctx.closePath();
}

/** A pad's shape as a path, centred on `at` and turned. */
export function padPath(ctx: CanvasRenderingContext2D, v: View2D, pad: BoardPad["pad"], at: P2, angle: number, grow = 0) {
  const s = toScreen(v, at);
  const w = (pad.w + grow * 2) * v.scale;
  const h = (pad.h + grow * 2) * v.scale;
  ctx.save();
  ctx.translate(s[0], s[1]);
  ctx.rotate((-angle * Math.PI) / 180);
  ctx.beginPath();
  if (pad.shape === "circle") ctx.arc(0, 0, Math.max(w, h) / 2, 0, Math.PI * 2);
  else {
    const r = pad.shape === "rect" ? 0 : pad.shape === "oval" ? Math.min(w, h) / 2 : Math.min(w, h) * (pad.round ?? 0.25);
    if (r > 0 && typeof ctx.roundRect === "function") ctx.roundRect(-w / 2, -h / 2, w, h, r);
    else ctx.rect(-w / 2, -h / 2, w, h);
  }
  ctx.restore();
}

function shapeOn(ctx: CanvasRenderingContext2D, v: View2D, s: Shape, place: (p: P2) => P2, turnBy: number, flip: boolean, colour: string, c: Colours) {
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, ("width" in s ? (s.width ?? 0.12) : 0.12) * v.scale);
  if (s.kind === "line") {
    path(ctx, v, s.pts.map(place), !!s.fill);
    if (s.fill) ctx.fill();
    ctx.stroke();
  } else if (s.kind === "rect") {
    path(
      ctx,
      v,
      (
        [
          [s.x1, s.y1],
          [s.x2, s.y1],
          [s.x2, s.y2],
          [s.x1, s.y2],
        ] as P2[]
      ).map(place),
      true,
    );
    if (s.fill) ctx.fill();
    ctx.stroke();
  } else if (s.kind === "circle") {
    const q = toScreen(v, place([s.cx, s.cy]));
    ctx.beginPath();
    ctx.arc(q[0], q[1], s.r * v.scale, 0, Math.PI * 2);
    if (s.fill) ctx.fill();
    ctx.stroke();
  } else if (s.kind === "arc") {
    const q = toScreen(v, place([s.cx, s.cy]));
    const a0 = flip ? 180 - s.a1 : s.a0;
    const a1 = flip ? 180 - s.a0 : s.a1;
    ctx.beginPath();
    ctx.arc(q[0], q[1], s.r * v.scale, (-(a0 + turnBy) * Math.PI) / 180, (-(a1 + turnBy) * Math.PI) / 180, true);
    ctx.stroke();
  } else {
    const q = toScreen(v, place([s.x, s.y]));
    ctx.font = `${Math.max(1, s.size * v.scale)}px ${c.font}`;
    ctx.textAlign = s.align === "centre" ? "center" : (s.align ?? "left");
    ctx.textBaseline = "middle";
    ctx.fillText(s.text, q[0], q[1]);
  }
}

export function drawBoard(ctx: CanvasRenderingContext2D, v: View2D, size: { w: number; h: number }, d: ElectronicsDesign, c: Colours, look: BoardLook) {
  ctx.fillStyle = c["ec-pcb-bg"];
  ctx.fillRect(0, 0, size.w, size.h);
  const board = d.board;
  if (!board) return;
  const show = (l: LayerId) => !look.hidden.has(l);
  const lit = (net: string) => !look.net || look.net === net;

  // The board itself, with its cut-outs taken out.
  const edge = outlinePoints(board.outline);
  ctx.fillStyle = c["ec-board"];
  ctx.beginPath();
  for (const loop of [edge, ...(board.cutouts ?? []).map((x) => outlinePoints(x))])
    loop.forEach((p, i) => {
      const s = toScreen(v, p);
      if (i) ctx.lineTo(s[0], s[1]);
      else ctx.moveTo(s[0], s[1]);
    });
  ctx.fill("evenodd");

  const order: CopperLayer[] = look.active === "top" ? ["bottom", "top"] : ["top", "bottom"];
  const copper = (layer: CopperLayer) => c[layer === "top" ? "ec-copper-top" : "ec-copper-bottom"];
  for (const layer of order) {
    if (!show(layer as LayerId)) continue;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const p of look.pours ?? []) if (p.shape.pour.layer === layer) paintPour(ctx, v, size, p, copper(layer), lit(p.shape.pour.net) ? 0.55 : 0.2);
    for (const t of board.tracks) {
      if (t.layer !== layer) continue;
      const on = look.selected.has(t.id) || look.hover === t.id;
      ctx.globalAlpha = lit(t.net) ? (layer === look.active ? 1 : 0.75) : 0.25;
      if (on) {
        ctx.strokeStyle = c["ec-pick"];
        ctx.lineWidth = t.width * v.scale + 3;
        path(ctx, v, t.pts);
        ctx.stroke();
      }
      ctx.strokeStyle = copper(layer);
      ctx.lineWidth = Math.max(1, t.width * v.scale);
      path(ctx, v, t.pts);
      ctx.stroke();
    }
    for (const p of look.pads) {
      if (p.pad.kind !== "smd" || p.side !== layer) continue;
      ctx.globalAlpha = lit(p.net) ? 1 : 0.3;
      ctx.fillStyle = copper(layer);
      padPath(ctx, v, p.pad, p.at, p.angle);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Holes go through everything: plated ones gold on every layer.
  if (show("holes")) {
    for (const p of look.pads) {
      if (p.pad.kind === "smd") continue;
      ctx.globalAlpha = lit(p.net) ? 1 : 0.3;
      if (p.pad.kind === "thru") {
        ctx.fillStyle = c["ec-pad"];
        padPath(ctx, v, p.pad, p.at, p.angle);
        ctx.fill();
      }
      const s = toScreen(v, p.at);
      ctx.fillStyle = c["ec-hole"];
      ctx.beginPath();
      ctx.arc(s[0], s[1], ((p.pad.drill ?? 0) / 2) * v.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const via of board.vias) {
      const s = toScreen(v, [via.x, via.y]);
      ctx.globalAlpha = lit(via.net) ? 1 : 0.3;
      if (look.selected.has(via.id) || look.hover === via.id) {
        ctx.fillStyle = c["ec-pick"];
        ctx.beginPath();
        ctx.arc(s[0], s[1], (via.diameter / 2) * v.scale + 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = c["ec-pad"];
      ctx.beginPath();
      ctx.arc(s[0], s[1], (via.diameter / 2) * v.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c["ec-hole"];
      ctx.beginPath();
      ctx.arc(s[0], s[1], (via.drill / 2) * v.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const h of board.holes) {
      const s = toScreen(v, [h.x, h.y]);
      if (h.pad) {
        ctx.fillStyle = c["ec-pad"];
        ctx.beginPath();
        ctx.arc(s[0], s[1], (h.pad / 2) * v.scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = c["ec-hole"];
      ctx.beginPath();
      ctx.arc(s[0], s[1], (h.drill / 2) * v.scale, 0, Math.PI * 2);
      ctx.fill();
      if (look.selected.has(h.id) || look.hover === h.id) {
        ctx.strokeStyle = c["ec-pick"];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s[0], s[1], (Math.max(h.pad ?? 0, h.drill) / 2) * v.scale + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Parts: silkscreen, outline and reference.
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  const places = [...board.placements, ...(look.ghost?.placements ?? []).map((g) => ({ ...g, ghost: true }))];
  for (const at of places) {
    const part = parts.get(at.part);
    const pkg = part && packageOf(d, part);
    if (!part || !pkg) continue;
    const ghost = "ghost" in at;
    const on = ghost || look.selected.has(at.part) || look.hover === at.part;
    const place = (p: P2) => placeOnBoard(p, at);
    const silk: LayerId = at.side === "top" ? "silk-top" : "silk-bottom";
    ctx.globalAlpha = ghost ? 0.6 : 1;
    for (const s of pkg.footprint.shapes) {
      if (s.layer === "silk" && show(silk)) shapeOn(ctx, v, s, place, at.rot, at.side === "bottom", c[at.side === "top" ? "ec-silk" : "ec-silk-far"], c);
      else if (s.layer === "courtyard" && (show("courtyard") || on)) {
        ctx.save();
        if (!on) ctx.globalAlpha = 0.5;
        shapeOn(ctx, v, { ...s, width: on ? 0.12 : 0.05 } as Shape, place, at.rot, at.side === "bottom", on ? c["ec-pick"] : c["ec-courtyard"], c);
        ctx.restore();
      }
    }
    if (ghost)
      for (const pad of pkg.footprint.pads) {
        ctx.fillStyle = pad.kind === "smd" ? copper(pad.back ? (at.side === "top" ? "bottom" : "top") : at.side) : c["ec-pad"];
        padPath(ctx, v, pad, place([pad.x, pad.y]), at.rot + (at.side === "bottom" ? -1 : 1) * (pad.angle ?? 0));
        ctx.fill();
      }
    if (show(silk) && !("refHidden" in at && at.refHidden) && v.scale >= 4) {
      const where = ("refAt" in at && at.refAt) || pkg.footprint.refAt || [0, 0];
      const s = toScreen(v, place(where));
      ctx.fillStyle = on ? c["ec-pick"] : c[at.side === "top" ? "ec-silk" : "ec-silk-far"];
      ctx.font = `${Math.max(9, Math.min(1 * v.scale, 22))}px ${c.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(part.ref, s[0], s[1]);
    }
    ctx.globalAlpha = 1;
  }

  for (const t of board.texts) {
    const layer: LayerId = t.layer.endsWith("top") ? "silk-top" : "silk-bottom";
    if (!show(layer)) continue;
    const s = toScreen(v, [t.x, t.y]);
    ctx.save();
    ctx.translate(s[0], s[1]);
    ctx.rotate((-(t.angle ?? 0) * Math.PI) / 180);
    if (t.layer.endsWith("bottom")) ctx.scale(-1, 1);
    ctx.fillStyle = look.selected.has(t.id)
      ? c["ec-pick"]
      : t.layer.startsWith("copper")
        ? copper(t.layer.endsWith("top") ? "top" : "bottom")
        : c[t.layer.endsWith("top") ? "ec-silk" : "ec-silk-far"];
    ctx.font = `${Math.max(1, t.size * v.scale)}px ${c.font}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(t.text, 0, 0);
    ctx.restore();
  }

  // Areas: keep-outs dashed, a pour's own outline thin, the picked one bright.
  ctx.lineJoin = "round";
  for (const k of board.keepouts) {
    const on = look.selected.has(k.id) || look.hover === k.id;
    ctx.strokeStyle = on ? c["ec-pick"] : c["ec-mark"];
    ctx.lineWidth = on ? 2 : 1;
    ctx.setLineDash([6, 4]);
    path(ctx, v, k.outline, true);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const p of board.pours) {
    const on = look.selected.has(p.id) || look.hover === p.id;
    if (!on && !show(p.layer as LayerId)) continue;
    ctx.strokeStyle = on ? c["ec-pick"] : copper(p.layer);
    ctx.globalAlpha = on ? 1 : 0.6;
    ctx.lineWidth = on ? 2 : 1;
    ctx.setLineDash([2, 3]);
    path(ctx, v, p.outline, true);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  (board.cutouts ?? []).forEach((cut, i) => {
    if (!look.selected.has(`cut:${i}`) && look.hover !== `cut:${i}`) return;
    ctx.strokeStyle = c["ec-pick"];
    ctx.lineWidth = 2;
    path(ctx, v, outlinePoints(cut), true);
    ctx.stroke();
  });
  if (look.area?.length) {
    ctx.strokeStyle = c["ec-pick"];
    ctx.fillStyle = c["ec-pick"];
    ctx.lineWidth = 1.5;
    path(ctx, v, look.area);
    ctx.stroke();
    for (const p of look.area.slice(0, -1)) {
      const s = toScreen(v, p);
      ctx.beginPath();
      ctx.arc(s[0], s[1], 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (show("edge")) {
    ctx.strokeStyle = c["ec-edge"];
    ctx.lineWidth = Math.max(1.5, 0.15 * v.scale);
    ctx.lineJoin = "round";
    for (const loop of [edge, ...(board.cutouts ?? []).map((x) => outlinePoints(x))]) {
      path(ctx, v, loop, true);
      ctx.stroke();
    }
  }

  if (show("ratsnest")) {
    ctx.strokeStyle = c["ec-pcb-ink"];
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (const a of look.air) {
      ctx.globalAlpha = lit(a.net) ? 0.9 : 0.2;
      path(ctx, v, [a.a, a.b]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  const g = look.ghost?.track;
  if (g && g.pts.length > 1) {
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = g.blocked ? c["ec-mark"] : copper(g.layer);
    ctx.lineWidth = Math.max(1, g.width * v.scale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    path(ctx, v, g.pts);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  for (const m of look.marks ?? []) {
    const s = toScreen(v, m.at);
    ctx.strokeStyle = c["ec-mark"];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s[0], s[1], 9, 0, Math.PI * 2);
    ctx.stroke();
    if (m.text) {
      ctx.fillStyle = c["ec-mark"];
      ctx.font = `600 12px ${c.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(m.text, s[0], s[1] - 12);
    }
  }
  if (look.box) rubber(ctx, v, look.box, { ...c, accent: c["ec-pick"] });
}
