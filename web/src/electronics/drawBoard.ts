import { pictureRects } from "@bettercad/electronics/pcb/picture";
import {
  outlinePoints,
  packageOf,
  placeOnBoard,
  type Air,
  type BoardNote,
  type BoardPad,
  type Box,
  type CopperLayer,
  type ElectronicsDesign,
  type NetColour,
  type P2,
  type Shape,
  type Side,
  trackPath,
} from "@bettercad/electronics";
import type { PourFill, PourShape } from "@bettercad/electronics/pcb/pour";
import { layerName, layersOf } from "@bettercad/electronics/pcb/stack";
import { copperMiddle, padOutline } from "@bettercad/electronics/padShape";
import { noteStrokes } from "@bettercad/electronics/pcb/notes";
import { REF_SIZE, boardTextLook, penFor, textStrokes } from "@bettercad/electronics/fab/font";
import type { Colours } from "./colours";
import { drawGroup, rubber } from "./drawSchematic";
import { toScreen, type View2D } from "./view2d";

/** The layers the Layers card lists. */
export type LayerId = "top" | "bottom" | `in${number}` | "silk-top" | "silk-bottom" | "courtyard" | "edge" | "holes" | "notes" | "ratsnest";
export const LAYERS: { id: LayerId; label: string; colour: keyof Colours; copper?: CopperLayer }[] = [
  { id: "top", label: "Top copper", colour: "ec-copper-top", copper: "top" },
  { id: "bottom", label: "Bottom copper", colour: "ec-copper-bottom", copper: "bottom" },
  { id: "silk-top", label: "Top silkscreen", colour: "ec-silk" },
  { id: "silk-bottom", label: "Bottom silkscreen", colour: "ec-silk-far" },
  { id: "courtyard", label: "Part outlines", colour: "ec-courtyard" },
  { id: "edge", label: "Board edge", colour: "ec-edge" },
  { id: "holes", label: "Holes", colour: "ec-pad" },
  { id: "notes", label: "Notes", colour: "ec-pcb-ink" },
  { id: "ratsnest", label: "Unrouted lines", colour: "ec-pcb-ink" },
];

/** The token each net colour (#740) is drawn with: the inner layers' colours and a few the theme already has. */
export const NET_COLOUR: Record<NetColour, keyof Colours> = {
  green: "ec-copper-in1",
  orange: "ec-copper-in2",
  teal: "ec-copper-in3",
  pink: "ec-copper-in4",
  yellow: "ec-mark",
  purple: "accent",
  blue: "snap",
};

/** The colour each copper layer is drawn in. */
export const copperColour = (layer: CopperLayer): keyof Colours =>
  layer === "top"
    ? "ec-copper-top"
    : layer === "bottom"
      ? "ec-copper-bottom"
      : (`ec-copper-in${Math.min(4, Math.max(1, Number(layer.slice(2)) || 1))}` as keyof Colours);

/** The layers of a board, for the Layers card: its inner copper layers (#648) sit between the top and the bottom. */
export function layersFor(board: { copperLayers: number }): typeof LAYERS {
  const inner = layersOf({ copperLayers: board.copperLayers as 2 | 4 | 6 }).slice(1, -1);
  if (!inner.length) return LAYERS;
  return [LAYERS[0]!, ...inner.map((l) => ({ id: l as LayerId, label: layerName(l), colour: copperColour(l), copper: l })), ...LAYERS.slice(1)];
}

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
  /** Parts that sit where they cannot: over another part, off the board or in a keep-out (#639). */
  clashing?: Set<string>;
  ghost?: {
    track?: { pts: P2[]; width: number; layer: CopperLayer; blocked?: boolean };
    /** The other track of a pair being routed. */
    mate?: { pts: P2[]; width: number; layer: CopperLayer; blocked?: boolean };
    placements?: { part: string; x: number; y: number; rot: number; side: Side }[];
  };
  box?: [P2, P2] | null;
  /** The pours as they fill: what to paint and the islands to leave out. */
  pours?: { shape: PourShape; fill: PourFill }[];
  /** A note being drawn (#749): a dimension or a line, as it would land. */
  note?: BoardNote[];
  /** An area being drawn, corner by corner. */
  area?: P2[];
  /** Pours drawn as their outlines only, so everything under them shows (#728). */
  pourOutlines?: boolean;
  /** How strongly pours are painted, over the shares the screen uses: the 3D board's picture paints them fuller. */
  pourAlpha?: number;
  /** Groups' outlines round their footprints (#774). */
  groups?: { id: string; name: string; box: Box; picked: boolean }[];
  /** Two points being measured between (#732). */
  measure?: P2[];
  /** Teardrops where tracks meet pads and vias (#743), worked out like pours. */
  teardrops?: { net: string; layer: CopperLayer; pts: P2[] }[];
  /** Corners of the picked track or area that drag (#742), and the one picked. */
  handles?: { pts: P2[]; picked?: number };
}

/**
 * How strongly a pour is painted (#728): light enough that a track over it reads at a glance, and fainter again on a
 * side you are not working on, or when another net is lit.
 */
export function pourAlpha(onActive: boolean, lit: boolean): number {
  if (!lit) return 0.08;
  return onActive ? 0.3 : 0.12;
}

/** How strongly a side you are not working on draws its tracks and pads, against 1 for the side you are on. */
export const FAR_ALPHA = 0.45;

/** Strokes of the board's own font, drawn with a round pen `pen` mm wide, as the Gerber files draw them (#730). */
export function strokeLines(ctx: CanvasRenderingContext2D, v: View2D, lines: P2[][], pen: number) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(0.75, pen * v.scale);
  ctx.beginPath();
  for (const line of lines)
    line.forEach((p, i) => {
      const s = toScreen(v, p);
      if (i) ctx.lineTo(s[0], s[1]);
      else ctx.moveTo(s[0], s[1]);
    });
  // A dot (a full stop) is one point drawn twice: a zero-length line still gets its round cap.
  ctx.stroke();
  ctx.restore();
}

/** A board text's strokes: its capitals are 0.72 of its size, as the Gerber writer draws them. */
export function boardTextStrokes(t: { text: string; size: number; x: number; y: number; angle?: number; layer: string; mirror?: boolean; width?: number }): {
  lines: P2[][];
  pen: number;
} {
  const cap = Math.max(0, t.size * 0.72);
  return { lines: textStrokes(t.text, cap, [t.x, t.y], boardTextLook(t)), pen: penFor(cap) };
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
  // A hatched pour's openings (#747), then the rings round its own pads.
  for (const sq of shape.holes) {
    path(o, v, sq, true);
    o.fill();
  }
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

/**
 * A pad's shape as a path, centred on `at` and turned. A polygon pad (#744) is drawn from its `outline` on the board;
 * copper off the hole's middle is centred on `centre`.
 */
export function padPath(
  ctx: CanvasRenderingContext2D,
  v: View2D,
  pad: BoardPad["pad"],
  at: P2,
  angle: number,
  grow = 0,
  where: { centre?: P2; outline?: P2[] } = {},
) {
  if (where.outline) {
    ctx.beginPath();
    where.outline.forEach((p, i) => {
      const s = toScreen(v, p);
      if (i) ctx.lineTo(s[0], s[1]);
      else ctx.moveTo(s[0], s[1]);
    });
    ctx.closePath();
    return;
  }
  const s = toScreen(v, where.centre ?? at);
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

export function shapeOn(ctx: CanvasRenderingContext2D, v: View2D, s: Shape, place: (p: P2) => P2, turnBy: number, flip: boolean, colour: string, _c?: Colours) {
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
    // The board's own stroke font, placed and turned as the Gerber writer does it (#730).
    const cap = s.size * 0.72;
    const lines = textStrokes(s.text, cap, place([s.x, s.y]), {
      angle: turnBy + (flip ? -1 : 1) * (s.angle ?? 0),
      align: s.align ?? "left",
      middle: true,
      mirror: flip,
    });
    strokeLines(ctx, v, lines, penFor(cap));
  }
}

export function drawBoard(ctx: CanvasRenderingContext2D, v: View2D, size: { w: number; h: number }, d: ElectronicsDesign, c: Colours, look: BoardLook) {
  ctx.fillStyle = c["ec-pcb-bg"];
  ctx.fillRect(0, 0, size.w, size.h);
  const board = d.board;
  if (!board) return;
  const show = (l: LayerId) => !look.hidden.has(l);
  const lit = (net: string) => !look.net || look.net === net;
  // A net with a colour of its own (#740) wears it on its unrouted lines, and on its tracks while it is lit.
  const netColour = (net: string) => {
    const k = board.netLooks?.[net]?.colour;
    return k ? c[NET_COLOUR[k]] : undefined;
  };

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

  // From the far side up, with the layer being worked on last, so it is on top.
  const all = layersOf(board);
  const order: CopperLayer[] = [
    ...(look.active === "top" ? [...all].reverse() : all).filter((l) => l !== look.active),
    ...(all.includes(look.active) ? [look.active] : []),
  ];
  const copper = (layer: CopperLayer) => c[copperColour(layer)];
  for (const layer of order) {
    if (!show(layer as LayerId)) continue;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const near = layer === look.active;
    if (!look.pourOutlines)
      for (const p of look.pours ?? [])
        if (p.shape.pour.layer === layer) paintPour(ctx, v, size, p, copper(layer), look.pourAlpha ?? pourAlpha(near, lit(p.shape.pour.net)));
    for (const t of board.tracks) {
      if (t.layer !== layer) continue;
      const on = look.selected.has(t.id) || look.hover === t.id;
      // Curved pieces (#755) drawn as fine chords.
      const shape = trackPath(t, 0.002);
      ctx.globalAlpha = lit(t.net) ? (near ? 1 : FAR_ALPHA) : 0.2;
      if (on) {
        ctx.strokeStyle = c["ec-pick"];
        ctx.lineWidth = t.width * v.scale + 3;
        path(ctx, v, shape);
        ctx.stroke();
      }
      ctx.strokeStyle = (look.net === t.net && netColour(t.net)) || copper(layer);
      ctx.lineWidth = Math.max(1, t.width * v.scale);
      path(ctx, v, shape);
      ctx.stroke();
    }
    for (const t of look.teardrops ?? []) {
      if (t.layer !== layer) continue;
      ctx.globalAlpha = lit(t.net) ? (near ? 1 : FAR_ALPHA) : 0.2;
      ctx.fillStyle = (look.net === t.net && netColour(t.net)) || copper(layer);
      path(ctx, v, t.pts);
      ctx.closePath();
      ctx.fill();
    }
    for (const p of look.pads) {
      if (p.pad.kind !== "smd" || p.side !== layer) continue;
      ctx.globalAlpha = lit(p.net) ? (near ? 1 : 0.6) : 0.3;
      ctx.fillStyle = copper(layer);
      padPath(ctx, v, p.pad, p.at, p.angle, 0, p);
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
        padPath(ctx, v, p.pad, p.at, p.angle, 0, p);
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
    // Fiducials and test points (#735) are drawn as pads; a fiducial shows its clear ring, and a picked one its outline.
    for (const m of board.marks ?? []) {
      const s = toScreen(v, [m.x, m.y]);
      if (m.kind === "fiducial") {
        ctx.strokeStyle = c["ec-pad"];
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(s[0], s[1], m.size * v.scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (look.selected.has(m.id) || look.hover === m.id) {
        ctx.strokeStyle = c["ec-pick"];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s[0], s[1], (m.kind === "fiducial" ? m.size : m.size / 2) * v.scale + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
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
      else if (s.layer === "courtyard" && (show("courtyard") || on || look.clashing?.has(at.part))) {
        const bad = !!look.clashing?.has(at.part);
        ctx.save();
        if (!on && !bad) ctx.globalAlpha = 0.5;
        shapeOn(
          ctx,
          v,
          { ...s, width: on || bad ? 0.12 : 0.05 } as Shape,
          place,
          at.rot,
          at.side === "bottom",
          bad ? c.danger : on ? c["ec-pick"] : c["ec-courtyard"],
          c,
        );
        ctx.restore();
      }
    }
    if (ghost)
      for (const pad of pkg.footprint.pads) {
        ctx.fillStyle = pad.kind === "smd" ? copper(pad.back ? (at.side === "top" ? "bottom" : "top") : at.side) : c["ec-pad"];
        padPath(ctx, v, pad, place([pad.x, pad.y]), at.rot + (at.side === "bottom" ? -1 : 1) * (pad.angle ?? 0), 0, {
          centre: place(copperMiddle(pad)),
          outline: padOutline(pad)?.map(place),
        });
        ctx.fill();
      }
    if (show(silk) && !("refHidden" in at && at.refHidden) && v.scale >= 3) {
      // In the board's own font and size, as the silkscreen file has it (#730).
      const where = ("refAt" in at && at.refAt) || pkg.footprint.refAt || [0, 0];
      const cap = Math.max(REF_SIZE, board.rules?.minSilkHeight ?? 0);
      ctx.strokeStyle = on ? c["ec-pick"] : c[at.side === "top" ? "ec-silk" : "ec-silk-far"];
      strokeLines(
        ctx,
        v,
        textStrokes(part.ref, cap, place(where), { align: "centre", middle: true, mirror: at.side === "bottom" }),
        penFor(cap, board.rules?.minSilkWidth ?? 0),
      );
    }
    ctx.globalAlpha = 1;
  }

  for (const t of board.texts) {
    const layer: LayerId = t.layer.endsWith("top") ? "silk-top" : "silk-bottom";
    if (!show(layer)) continue;
    // The strokes the files for the board house draw (#730), further lines below the first.
    const { lines, pen } = boardTextStrokes(t);
    ctx.strokeStyle =
      look.selected.has(t.id) || look.hover === t.id
        ? c["ec-pick"]
        : t.layer.startsWith("copper")
          ? copper(t.layer.endsWith("top") ? "top" : "bottom")
          : c[t.layer.endsWith("top") ? "ec-silk" : "ec-silk-far"];
    strokeLines(ctx, v, lines, t.layer.startsWith("silk") ? Math.max(pen, board.rules?.minSilkWidth ?? 0) : pen);
  }

  // Notes for whoever makes the board (#749): dimensions, lines and words.
  if (show("notes"))
    for (const n of board.notes ?? []) {
      const { lines, pen } = noteStrokes(n);
      ctx.strokeStyle = look.selected.has(n.id) || look.hover === n.id ? c["ec-pick"] : c["ec-pcb-ink"];
      strokeLines(ctx, v, lines, pen);
    }
  if (look.note?.length) {
    ctx.strokeStyle = c["ec-pick"];
    strokeLines(
      ctx,
      v,
      look.note.flatMap((n) => noteStrokes(n).lines),
      0.1,
    );
  }

  // Pictures on the silkscreen: the ink, a cell at a time.
  for (const pic of board.pictures ?? []) {
    if (!show(pic.layer)) continue;
    const on = look.selected.has(pic.id) || look.hover === pic.id;
    ctx.fillStyle = on ? c["ec-pick"] : c[pic.layer === "silk-top" ? "ec-silk" : "ec-silk-far"];
    for (const r of pictureRects(pic)) {
      const a = toScreen(v, [r.x1, r.y2]);
      const b = toScreen(v, [r.x2, r.y1]);
      ctx.fillRect(a[0], a[1], Math.max(1, b[0] - a[0]), Math.max(1, b[1] - a[1]));
    }
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
  // Area rules (#760): a dotted outline with the rule's name in its corner.
  for (const r of board.customRules ?? []) {
    if (r.kind !== "area" || !r.area?.length) continue;
    ctx.strokeStyle = c["ec-mark"];
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    path(ctx, v, r.area, true);
    ctx.stroke();
    ctx.setLineDash([]);
    const [x, y] = toScreen(v, [Math.min(...r.area.map((p) => p[0])), Math.max(...r.area.map((p) => p[1]))]);
    ctx.fillStyle = c["ec-mark"];
    ctx.font = `11px ${c.font}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(r.name, x + 3, y + 3);
  }
  for (const p of board.pours) {
    const on = look.selected.has(p.id) || look.hover === p.id;
    if (!on && !show(p.layer as LayerId)) continue;
    ctx.strokeStyle = on ? c["ec-pick"] : copper(p.layer);
    ctx.globalAlpha = on || look.pourOutlines ? 1 : 0.6;
    ctx.lineWidth = on ? 2 : look.pourOutlines ? 1.5 : 1;
    // Shown as outlines only (#728), the edge is all there is of a pour: drawn solid so it reads.
    ctx.setLineDash(look.pourOutlines ? [] : [2, 3]);
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
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (const a of look.air) {
      // A net whose lines are hidden still counts them as left to route; the status strip says so.
      if (board.netLooks?.[a.net]?.hideAir) continue;
      ctx.strokeStyle = netColour(a.net) ?? c["ec-pcb-ink"];
      ctx.lineWidth = netColour(a.net) ? 1.5 : 1;
      ctx.globalAlpha = lit(a.net) ? 0.9 : 0.2;
      path(ctx, v, [a.a, a.b]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  for (const g of [look.ghost?.track, look.ghost?.mate]) {
    if (!g || g.pts.length < 2) continue;
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
  const gc = { ...c, accent: c["ec-pick"], muted: c["ec-pcb-ink"] };
  for (const g of look.groups ?? []) drawGroup(ctx, v, g, gc, g.picked, false);
  if (look.measure?.length) drawMeasure(ctx, v, look.measure, c);
  // Corners that drag (#742): small squares, the picked one filled.
  if (look.handles)
    for (const [i, p] of look.handles.pts.entries()) {
      const s = toScreen(v, p);
      ctx.fillStyle = i === look.handles.picked ? c["ec-pick"] : c["ec-pcb-bg"];
      ctx.strokeStyle = c["ec-pick"];
      ctx.lineWidth = 1.5;
      ctx.fillRect(s[0] - 4, s[1] - 4, 8, 8);
      ctx.strokeRect(s[0] - 4, s[1] - 4, 8, 8);
    }
  if (look.box) rubber(ctx, v, look.box, { ...c, accent: c["ec-pick"] });
}

/** The measure tool's line (#732): a dot on each point, a line between, and the distance over its middle. */
function drawMeasure(ctx: CanvasRenderingContext2D, v: View2D, pts: P2[], c: Colours) {
  const [a, b] = pts.map((p) => toScreen(v, p));
  ctx.save();
  ctx.strokeStyle = c["ec-pick"];
  ctx.fillStyle = c["ec-pick"];
  ctx.lineWidth = 1.5;
  if (a && b) {
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const s of [a, b]) {
    if (!s) continue;
    ctx.beginPath();
    ctx.arc(s[0], s[1], 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
