import type { P2 } from "../model";
import { shapeFromLoops, type OutlineShape } from "./outline";

/**
 * A board outline from a DXF file (#638), the drawing most CAD programs can write. Lines, arcs, circles, ellipses and
 * polylines (with their bulges) are read and joined end to end into closed shapes; curves come in as short straight
 * runs, as an outline from a sketch does. The biggest closed shape is the board's edge and the shapes inside it are
 * cut-outs. The file's units are honoured where it says them, else it is taken as millimetres.
 */
export interface DxfOutline {
  shape: OutlineShape | null;
  /** What was left out, in words for the person: open shapes, kinds of thing not read. */
  notes: string[];
}

/** Millimetres to one drawing unit, by the file's $INSUNITS. */
const UNITS: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0000254, 9: 0.0254, 10: 914.4, 13: 0.001, 14: 100 };

/** How far apart two ends can be and still be one corner, mm. */
const JOIN = 0.01;
/** How far a straight run may stray from the curve it stands for, mm. */
const SAG = 0.02;

type Pair = [number, string];

function pairs(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (Number.isInteger(code)) out.push([code, lines[i + 1]!.trim()]);
  }
  return out;
}

/** Points along an arc about `c`, from angle `a` round to `b` (radians; anticlockwise when b > a). */
function arc(c: P2, r: number, a: number, b: number): P2[] {
  const step = 2 * Math.acos(Math.max(-1, 1 - SAG / Math.max(r, SAG)));
  const n = Math.max(2, Math.min(360, Math.ceil(Math.abs(b - a) / Math.max(step, 1e-3))));
  return Array.from({ length: n + 1 }, (_, i): P2 => [c[0] + r * Math.cos(a + ((b - a) * i) / n), c[1] + r * Math.sin(a + ((b - a) * i) / n)]);
}

/** A polyline's corners with its bulges drawn out as arcs. */
function bulged(pts: { p: P2; bulge: number }[], closed: boolean): P2[] {
  const out: P2[] = [];
  const count = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    out.push(a.p);
    if (Math.abs(a.bulge) < 1e-9) continue;
    const chord = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]);
    if (chord < 1e-9) continue;
    const turn = 4 * Math.atan(a.bulge);
    const r = chord / (2 * Math.sin(Math.abs(turn) / 2));
    // The centre is to the left of the chord for an anticlockwise bulge.
    const h = r * Math.cos(turn / 2) * Math.sign(a.bulge);
    const mid: P2 = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2];
    const c: P2 = [mid[0] - ((b.p[1] - a.p[1]) / chord) * h, mid[1] + ((b.p[0] - a.p[0]) / chord) * h];
    const from = Math.atan2(a.p[1] - c[1], a.p[0] - c[0]);
    out.push(...arc(c, r, from, from + turn).slice(1, -1));
  }
  if (!closed) out.push(pts[pts.length - 1]!.p);
  return out;
}

const KINDS: Record<string, string> = {
  SPLINE: "splines",
  TEXT: "text",
  MTEXT: "text",
  DIMENSION: "dimensions",
  INSERT: "blocks",
  HATCH: "hatching",
  POINT: "points",
};

export function dxfOutline(text: string): DxfOutline {
  const all = pairs(text);
  let scale = 1;
  const units = all.findIndex(([c, v]) => c === 9 && v === "$INSUNITS");
  if (units >= 0 && all[units + 1]?.[0] === 70) scale = UNITS[Number(all[units + 1]![1])] ?? 1;

  // The drawing itself: the ENTITIES section where there is one, else the whole file.
  const start = all.findIndex(([c, v], i) => c === 2 && v === "ENTITIES" && all[i - 1]?.[1] === "SECTION");
  const end = start < 0 ? all.length : all.findIndex(([c, v], i) => i > start && c === 0 && v === "ENDSEC");
  const body = all.slice(start < 0 ? 0 : start + 1, end < 0 ? all.length : end);

  const loops: P2[][] = [];
  const open: P2[][] = [];
  const skipped = new Map<string, number>();
  const mm = (p: P2): P2 => [p[0] * scale, p[1] * scale];
  const add = (pts: P2[], closed: boolean) => {
    const real = pts.map(mm);
    if (closed || (real.length > 2 && Math.hypot(real[0]![0] - real.at(-1)![0], real[0]![1] - real.at(-1)![1]) < JOIN)) loops.push(real);
    else if (real.length > 1) open.push(real);
  };

  let poly: { closed: boolean; pts: { p: P2; bulge: number }[] } | null = null;
  for (let i = 0; i < body.length; i += 1) {
    if (body[i]![0] !== 0) continue;
    const kind = body[i]![1];
    let j = i + 1;
    while (j < body.length && body[j]![0] !== 0) j += 1;
    const own = body.slice(i + 1, j);
    const num = (code: number, or = 0) => {
      const hit = own.find(([c]) => c === code);
      return hit ? Number(hit[1]) : or;
    };
    if (kind === "LINE") {
      add(
        [
          [num(10), num(20)],
          [num(11), num(21)],
        ],
        false,
      );
    } else if (kind === "CIRCLE") {
      add(arc([num(10), num(20)], num(40), 0, 2 * Math.PI).slice(0, -1), true);
    } else if (kind === "ARC") {
      const from = (num(50) * Math.PI) / 180;
      let to = (num(51) * Math.PI) / 180;
      if (to <= from) to += 2 * Math.PI;
      add(arc([num(10), num(20)], num(40), from, to), false);
    } else if (kind === "ELLIPSE") {
      const c: P2 = [num(10), num(20)];
      const major: P2 = [num(11), num(21)];
      const a = Math.hypot(major[0], major[1]);
      const b = a * num(40, 1);
      const turn = Math.atan2(major[1], major[0]);
      const [from, to] = [num(41, 0), num(42, 2 * Math.PI)];
      const whole = Math.abs(to - from - 2 * Math.PI) < 1e-6;
      // Stepped as a circle of the ellipse's size, so a big one gets enough points.
      const size = Math.max(a, b) * scale || 1;
      const pts = arc([0, 0], size, from, to > from ? to : to + 2 * Math.PI).map(([x, y]): P2 => {
        const [ex, ey] = [(a * x) / size, (b * y) / size];
        return [c[0] + ex * Math.cos(turn) - ey * Math.sin(turn), c[1] + ex * Math.sin(turn) + ey * Math.cos(turn)];
      });
      add(whole ? pts.slice(0, -1) : pts, whole);
    } else if (kind === "LWPOLYLINE") {
      const pts: { p: P2; bulge: number }[] = [];
      for (let k = 0; k < own.length; k += 1) {
        if (own[k]![0] === 10) pts.push({ p: [Number(own[k]![1]), 0], bulge: 0 });
        else if (own[k]![0] === 20 && pts.length) pts.at(-1)!.p[1] = Number(own[k]![1]);
        else if (own[k]![0] === 42 && pts.length) pts.at(-1)!.bulge = Number(own[k]![1]);
      }
      const closed = (num(70) & 1) === 1;
      if (pts.length > 1) add(bulged(pts, closed), closed);
    } else if (kind === "POLYLINE") {
      poly = { closed: (num(70) & 1) === 1, pts: [] };
    } else if (kind === "VERTEX" && poly) {
      poly.pts.push({ p: [num(10), num(20)], bulge: num(42) });
    } else if (kind === "SEQEND" && poly) {
      if (poly.pts.length > 1) add(bulged(poly.pts, poly.closed), poly.closed);
      poly = null;
    } else if (kind !== "ENDSEC" && kind !== "SECTION" && kind !== "EOF" && start >= 0) {
      const name = KINDS[kind] ?? "other things";
      skipped.set(name, (skipped.get(name) ?? 0) + 1);
    }
    i = j - 1;
  }

  // Loose pieces are joined end to end, either way round, until a shape closes.
  const near = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < JOIN;
  let left = 0;
  while (open.length) {
    let run = open.pop()!;
    // It grows at its tail; when nothing more fits there it is turned round once, to grow at the other end.
    for (let turned = false; !near(run[0]!, run.at(-1)!);) {
      const tail = run.at(-1)!;
      const k = open.findIndex((o) => near(o[0]!, tail) || near(o.at(-1)!, tail));
      if (k < 0) {
        if (turned) break;
        turned = true;
        run.reverse();
        continue;
      }
      const [o] = open.splice(k, 1) as [P2[]];
      run = near(o[0]!, tail) ? [...run, ...o.slice(1)] : [...run, ...o.slice(0, -1).reverse()];
    }
    if (run.length > 3 && near(run[0]!, run.at(-1)!)) loops.push(run.slice(0, -1));
    else left += 1;
  }

  const notes: string[] = [];
  if (left) notes.push(left === 1 ? "1 open shape was left out." : `${left} open shapes were left out.`);
  if (skipped.size) notes.push(`Not read: ${[...skipped].map(([name, n]) => `${name} (${n})`).join(", ")}.`);
  return { shape: shapeFromLoops(loops), notes };
}
