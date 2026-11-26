/**
 * A sketch drawn flat for a drawing sheet: its curves seen from a view frame, with no OpenCascade, so a sheet can show
 * a sketch with its sizes. Each curve keeps the sketch entity's id as its name, so drawing dimensions can be fixed to
 * it the way they are fixed to a body's edges. Construction curves come back as hidden edges (drawn dashed);
 * geometry projected from the model is left out, as it is the model's, not the sketch's.
 *
 * Every point also comes back as a hidden edge of no length named `p:<id>`, which draws nothing but gives a size
 * from a lone point or an arc's end something to be measured from.
 */
import { ellipseGeo, frameY, planeFrame, sampleSpline, SketchIndex, splineGeo, textsOf, type Sketch, type Vec2 } from "@bettercad/sketch";
import { turn, viewAxes, type ModelView, type V2, type V3, type ViewCurve, type ViewFrame } from "./view";

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The view frame that looks straight at a sketch, its X to the right and its Y up the sheet. */
export function sketchFrame(sketch: Pick<Sketch, "plane">): ViewFrame {
  const f = planeFrame(sketch.plane);
  // Rounded, so a saved drawing reads the same on every machine (and has no -0 in it).
  const r = (v: V3): V3 => [Math.round(v[0] * 1e9) / 1e9 + 0, Math.round(v[1] * 1e9) / 1e9 + 0, Math.round(v[2] * 1e9) / 1e9 + 0];
  return { toEye: r(f.normal), up: r(frameY(f)) };
}

/** The sketch's id a view of it names its curves by, as a drawing ref's `body`. */
export const sketchBody = (id: string) => `sketch:${id}`;

export function sketchView(sketch: Sketch | undefined, frame: ViewFrame, id: string): ModelView {
  const empty: ModelView = { edges: [], box: { min: [0, 0], max: [0, 0] }, rounds: [], bodies: [], ms: 0 };
  if (!sketch) return empty;
  const f = planeFrame(sketch.plane);
  const fy = frameY(f);
  // The kernel's own axes for the frame, so a sketch lines up the way a body seen from there does.
  const { x: right, y: up } = viewAxes(frame);
  // Sketch millimetres straight onto the view plane: a turn and a shift (and a flip when seen from behind) when the
  // sketch faces the eye, a squash otherwise.
  const o: V2 = [dot(f.origin, right), dot(f.origin, up)];
  const ex: V2 = [dot(f.x, right), dot(f.x, up)];
  const ey: V2 = [dot(fy, right), dot(fy, up)];
  const on = (p: Vec2): V2 => [o[0] + ex[0] * p[0] + ey[0] * p[1], o[1] + ex[1] * p[0] + ey[1] * p[1]];
  const det = ex[0] * ey[1] - ex[1] * ey[0];
  const square = Math.abs(Math.hypot(...ex) - 1) < 1e-9 && Math.abs(Math.hypot(...ey) - 1) < 1e-9 && Math.abs(ex[0] * ey[0] + ex[1] * ey[1]) < 1e-9;
  const spin = Math.atan2(ex[1], ex[0]);
  const idx = new SketchIndex(sketch);
  const xy = (p: string): Vec2 | undefined => {
    const e = idx.get(p);
    return e?.kind === "point" ? [e.x, e.y] : undefined;
  };
  const round = (c: Vec2, r: number, from?: number, to?: number): ViewCurve => {
    if (square) {
      const cc = on(c);
      if (from === undefined || to === undefined) return { kind: "circle", c: cc, r };
      // Seen from behind, anticlockwise on the sketch is clockwise on the sheet: the arc runs from its other end.
      return det > 0
        ? { kind: "arc", c: cc, r, from: turn(spin + from), to: turn(spin + to) }
        : { kind: "arc", c: cc, r, from: turn(spin - to), to: turn(spin - from) };
    }
    const a = from ?? 0;
    const sweep = from === undefined || to === undefined ? Math.PI * 2 : turn(to - a) || Math.PI * 2;
    const n = Math.max(8, Math.ceil((sweep / (Math.PI * 2)) * 96));
    const pts: V2[] = [];
    for (let i = 0; i <= n; i++) pts.push(on([c[0] + r * Math.cos(a + (sweep * i) / n), c[1] + r * Math.sin(a + (sweep * i) / n)]));
    return { kind: "poly", pts };
  };
  const edges: ModelView["edges"] = [];
  const put = (curve: ViewCurve, name: string, construction: boolean) =>
    edges.push({ curve, visible: !construction, type: "sharp", source: { body: sketchBody(id), kind: "edge", index: edges.length, name } });
  for (const e of sketch.entities) {
    if (e.projectedFrom || e.kind === "point") continue;
    const cons = !!e.construction;
    try {
      if (e.kind === "line") {
        const [a, b] = [xy(e.a), xy(e.b)];
        if (a && b) put({ kind: "line", a: on(a), b: on(b) }, e.id, cons);
      } else if (e.kind === "circle") {
        const c = xy(e.c);
        if (c) put(round(c, e.r), e.id, cons);
      } else if (e.kind === "arc") {
        const [c, a, b] = [xy(e.c), xy(e.a), xy(e.b)];
        if (c && a && b) put(round(c, e.r, Math.atan2(a[1] - c[1], a[0] - c[0]), Math.atan2(b[1] - c[1], b[0] - c[0])), e.id, cons);
      } else if (e.kind === "ellipse") {
        const g = ellipseGeo(idx, e);
        const pts: V2[] = [];
        for (let i = 0; i <= 96; i++) {
          const t = (i / 96) * Math.PI * 2;
          const [u, v] = [g.r1 * Math.cos(t), g.r2 * Math.sin(t)];
          pts.push(on([g.c[0] + u * Math.cos(g.rot) - v * Math.sin(g.rot), g.c[1] + u * Math.sin(g.rot) + v * Math.cos(g.rot)]));
        }
        put({ kind: "poly", pts }, e.id, cons);
      } else if (e.kind === "spline") {
        put({ kind: "poly", pts: sampleSpline(splineGeo(idx, e)).map(on) }, e.id, cons);
      }
    } catch {
      // A curve that has lost a point has nothing to draw.
    }
  }
  try {
    for (const t of textsOf(sketch)) {
      for (const l of t.loops) if (l.length > 1) put({ kind: "poly", pts: [...l, l[0]!].map(on) }, `${t.text.id}`, !!t.text.construction);
    }
  } catch {
    // Text whose font has not loaded is left out.
  }
  const curves = edges.length;
  for (const p of sketch.entities) {
    if (p.kind !== "point" || p.projectedFrom) continue;
    const q = on([p.x, p.y]);
    edges.push({
      curve: { kind: "line", a: q, b: q },
      visible: false,
      type: "sharp",
      source: { body: sketchBody(id), kind: "edge", index: edges.length, name: `p:${p.id}` },
    });
  }
  if (!curves) return empty;
  const min: V2 = [Infinity, Infinity];
  const max: V2 = [-Infinity, -Infinity];
  const add = (p: V2) => {
    min[0] = Math.min(min[0], p[0]);
    min[1] = Math.min(min[1], p[1]);
    max[0] = Math.max(max[0], p[0]);
    max[1] = Math.max(max[1], p[1]);
  };
  for (const { curve: c } of edges) {
    if (c.kind === "line") [c.a, c.b].forEach(add);
    else if (c.kind === "poly") c.pts.forEach(add);
    else if (c.kind === "circle") {
      add([c.c[0] - c.r, c.c[1] - c.r]);
      add([c.c[0] + c.r, c.c[1] + c.r]);
    } else if (c.kind === "arc") {
      const sweep = turn(c.to - c.from) || Math.PI * 2;
      for (let i = 0; i <= 64; i++) add([c.c[0] + c.r * Math.cos(c.from + (sweep * i) / 64), c.c[1] + c.r * Math.sin(c.from + (sweep * i) / 64)]);
    }
  }
  return { edges, box: { min, max }, rounds: [], bodies: [], ms: 0 };
}
