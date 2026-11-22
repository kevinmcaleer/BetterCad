/**
 * A sketch as a DXF drawing, for cutting machines and laser cutters (Cricut Design Space, LightBurn, Inkscape). Every
 * closed shape is one closed polyline, so a cutter sees an outline it can cut and fill rather than loose lines: straight
 * edges and round arcs stay exact (arcs as polyline bulges), and ellipses, splines and text outlines are traced finely.
 * A whole circle is a CIRCLE. Curves that don't close a shape go on their own layer, OPEN, as lines, arcs and
 * polylines. Construction geometry is left out. Units are millimetres, in the sketch's own X and Y.
 *
 * Written as AutoCAD R12 (AC1009) ASCII with $INSUNITS set, the plainest DXF that almost every program reads.
 */
import { ellipseGeo, sampleEllipse, SketchIndex, type Id, type Sketch, type Vec2 } from "./model";
import { angleOf, sampleArc, sub, sweep } from "./geom2d";
import { profiles, type Loop } from "./profiles";
import { sampleSpline, splineGeo } from "./spline";

export interface SketchDxf {
  /** The DXF file's text. */
  text: string;
  /** Closed shapes written (outlines and holes). */
  shapes: number;
  /** Curves that don't close a shape, written on the OPEN layer. */
  open: number;
  /** What to add to "Saved <file>": empty, or a sentence on the curves that don't close a shape. */
  note: string;
}

/** One vertex of a closed polyline: where it is, and the bulge (tan of a quarter of the arc's sweep) to the next. */
type Vertex = { p: Vec2; bulge: number };

const TOL = 1e-6;
const same = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-4;
const num = (n: number) => {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? "0" : String(r);
};

class Writer {
  private out: string[] = [];
  pair(code: number, value: string | number): void {
    this.out.push(String(code).padStart(3), typeof value === "number" ? num(value) : value);
  }
  text(): string {
    return this.out.length ? `${this.out.join("\r\n")}\r\n` : "";
  }
}

/**
 * A loop as exact lines and arcs, when it is made only of whole lines and arcs that meet end to end; null when it has
 * an ellipse, a spline, text or a cut piece, which go as traced points instead.
 */
function exactLoop(idx: SketchIndex, loop: Loop): Vertex[] | null {
  const out: Vertex[] = [];
  for (const edge of loop.edges) {
    if (edge.span || edge.loop !== undefined) return null;
    const e = idx.get(edge.id);
    if (!e || (e.kind !== "line" && e.kind !== "arc")) return null;
    const [a, b] = [idx.xy(e.a), idx.xy(e.b)];
    const start = edge.reversed ? b : a;
    if (e.kind === "line") out.push({ p: start, bulge: 0 });
    else {
      const c = idx.xy(e.c);
      const w = sweep(angleOf(sub(a, c)), angleOf(sub(b, c)));
      out.push({ p: start, bulge: (edge.reversed ? -1 : 1) * Math.tan(w / 4) });
    }
  }
  // Each edge must start where the one before it ends.
  for (let i = 0; i < loop.edges.length; i++) {
    const edge = loop.edges[i]!;
    const e = idx.get(edge.id) as { a: Id; b: Id };
    const end = idx.xy(edge.reversed ? e.a : e.b);
    if (!same(end, out[(i + 1) % out.length]!.p)) return null;
  }
  return out.length >= 2 ? out : null;
}

/** A single whole circle (or an arc that closes on itself) as centre and radius. */
function circleOf(idx: SketchIndex, loop: Loop): { c: Vec2; r: number } | null {
  if (loop.edges.length !== 1) return null;
  const edge = loop.edges[0]!;
  if (edge.span) return null;
  const e = idx.get(edge.id);
  if (e?.kind === "circle" || e?.kind === "arc") return { c: idx.xy(e.c), r: e.r };
  return null;
}

/** Drops points that repeat the one before (and a last point that repeats the first). */
function tidy(points: Vec2[], closed: boolean): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) if (!out.length || !same(out[out.length - 1]!, p)) out.push(p);
  if (closed && out.length > 1 && same(out[0]!, out[out.length - 1]!)) out.pop();
  return out;
}

export function sketchDxf(sketch: Sketch): SketchDxf {
  const idx = new SketchIndex(sketch);
  const ents = new Writer();
  const box = { min: [Infinity, Infinity] as Vec2, max: [-Infinity, -Infinity] as Vec2 };
  const grow = (p: Vec2, pad = 0) => {
    box.min = [Math.min(box.min[0], p[0] - pad), Math.min(box.min[1], p[1] - pad)];
    box.max = [Math.max(box.max[0], p[0] + pad), Math.max(box.max[1], p[1] + pad)];
  };

  const polyline = (layer: string, verts: Vertex[], closed: boolean) => {
    ents.pair(0, "POLYLINE");
    ents.pair(8, layer);
    ents.pair(66, 1);
    ents.pair(10, 0);
    ents.pair(20, 0);
    ents.pair(30, 0);
    ents.pair(70, closed ? 1 : 0);
    for (const v of verts) {
      ents.pair(0, "VERTEX");
      ents.pair(8, layer);
      ents.pair(10, v.p[0]);
      ents.pair(20, v.p[1]);
      ents.pair(30, 0);
      if (Math.abs(v.bulge) > TOL) ents.pair(42, v.bulge);
      grow(v.p);
    }
    ents.pair(0, "SEQEND");
    ents.pair(8, layer);
  };
  const circle = (layer: string, c: Vec2, r: number) => {
    ents.pair(0, "CIRCLE");
    ents.pair(8, layer);
    ents.pair(10, c[0]);
    ents.pair(20, c[1]);
    ents.pair(30, 0);
    ents.pair(40, r);
    grow(c, r);
  };

  // Closed shapes: each profile's outline and its holes. The exact polyline's bulges can reach past its vertices,
  // so the drawing's extents come from the traced points.
  const used = new Set<Id>();
  let shapes = 0;
  for (const prof of profiles(sketch).profiles) {
    for (const loop of [prof, ...prof.holes]) {
      for (const e of loop.edges) used.add(e.id);
      const round = circleOf(idx, loop);
      if (round) circle("OUTLINE", round.c, round.r);
      else {
        const pts = tidy(loop.points, true);
        const exact = exactLoop(idx, loop);
        if (!exact && pts.length < 3) continue;
        polyline("OUTLINE", exact ?? pts.map((p) => ({ p, bulge: 0 })), true);
        for (const p of pts) grow(p);
      }
      shapes++;
    }
  }

  // Everything else that would be cut: curves left out of every shape (open ends, stray lines).
  let open = 0;
  for (const e of sketch.entities) {
    if (e.kind === "point" || e.construction || used.has(e.id)) continue;
    if (e.kind === "line") {
      const [a, b] = [idx.xy(e.a), idx.xy(e.b)];
      ents.pair(0, "LINE");
      ents.pair(8, "OPEN");
      ents.pair(10, a[0]);
      ents.pair(20, a[1]);
      ents.pair(30, 0);
      ents.pair(11, b[0]);
      ents.pair(21, b[1]);
      ents.pair(31, 0);
      grow(a);
      grow(b);
    } else if (e.kind === "circle") circle("OPEN", idx.xy(e.c), e.r);
    else if (e.kind === "arc") {
      const [c, a, b] = [idx.xy(e.c), idx.xy(e.a), idx.xy(e.b)];
      const [s, t] = [angleOf(sub(a, c)), angleOf(sub(b, c))];
      ents.pair(0, "ARC");
      ents.pair(8, "OPEN");
      ents.pair(10, c[0]);
      ents.pair(20, c[1]);
      ents.pair(30, 0);
      ents.pair(40, e.r);
      ents.pair(50, (s * 180) / Math.PI);
      ents.pair(51, (t * 180) / Math.PI);
      for (const p of sampleArc(c, e.r, s, t)) grow(p);
    } else if (e.kind === "ellipse") {
      const pts = tidy(sampleEllipse(ellipseGeo(idx, e)), true);
      polyline(
        "OPEN",
        pts.map((p) => ({ p, bulge: 0 })),
        true,
      );
    } else if (e.kind === "spline") {
      const g = splineGeo(idx, e);
      if (!g.bez.length) continue;
      const pts = tidy(sampleSpline(g), !!g.closed);
      polyline(
        "OPEN",
        pts.map((p) => ({ p, bulge: 0 })),
        !!g.closed,
      );
    }
    open++;
  }

  if (!(box.min[0] <= box.max[0])) box.min = box.max = [0, 0];
  const w = new Writer();
  w.pair(0, "SECTION");
  w.pair(2, "HEADER");
  w.pair(9, "$ACADVER");
  w.pair(1, "AC1009");
  // 4: millimetres. $MEASUREMENT 1: metric.
  w.pair(9, "$INSUNITS");
  w.pair(70, 4);
  w.pair(9, "$MEASUREMENT");
  w.pair(70, 1);
  w.pair(9, "$EXTMIN");
  w.pair(10, box.min[0]);
  w.pair(20, box.min[1]);
  w.pair(30, 0);
  w.pair(9, "$EXTMAX");
  w.pair(10, box.max[0]);
  w.pair(20, box.max[1]);
  w.pair(30, 0);
  w.pair(0, "ENDSEC");

  w.pair(0, "SECTION");
  w.pair(2, "TABLES");
  w.pair(0, "TABLE");
  w.pair(2, "LTYPE");
  w.pair(70, 1);
  w.pair(0, "LTYPE");
  w.pair(2, "CONTINUOUS");
  w.pair(70, 0);
  w.pair(3, "Solid line");
  w.pair(72, 65);
  w.pair(73, 0);
  w.pair(40, 0);
  w.pair(0, "ENDTAB");
  w.pair(0, "TABLE");
  w.pair(2, "LAYER");
  w.pair(70, 3);
  for (const [name, colour] of [
    ["0", 7],
    ["OUTLINE", 7],
    ["OPEN", 1],
  ] as const) {
    w.pair(0, "LAYER");
    w.pair(2, name);
    w.pair(70, 0);
    w.pair(62, colour);
    w.pair(6, "CONTINUOUS");
  }
  w.pair(0, "ENDTAB");
  w.pair(0, "ENDSEC");

  w.pair(0, "SECTION");
  w.pair(2, "ENTITIES");
  const body = ents.text();
  const tail = new Writer();
  tail.pair(0, "ENDSEC");
  tail.pair(0, "EOF");
  const note = !open
    ? ""
    : open === 1
      ? ". 1 curve doesn't close a shape, so a cutter treats it as a line."
      : `. ${open} curves don't close a shape, so a cutter treats them as lines.`;
  return { text: w.text() + body + tail.text(), shapes, open, note };
}
