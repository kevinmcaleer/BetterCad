import { SketchIndex, constraintRefs, type Constraint, type Dimension, type Id, type Sketch, type Vec2 } from "./model";

/**
 * Degrees of freedom per entity (#58). planegcs reports the sketch's total; to colour each entity we need to know which
 * of its numbers are still free. Each constraint is written here as residuals, the Jacobian is taken numerically at the
 * solved geometry, and a number is fixed when it has no part in the Jacobian's null space. The system is split into
 * independent groups first, so a sketch of many separate shapes stays fast.
 */
export interface Freedom {
  /** The sketch's degrees of freedom. */
  dof: number;
  /** Entities whose every number is fixed. */
  fixed: Set<Id>;
}

type Params = { values: number[]; index: Map<string, number> };
type Residual = { params: number[]; f: (v: number[]) => number };

export function freedom(sketch: Sketch): Freedom {
  const idx = new SketchIndex(sketch);
  const P: Params = { values: [], index: new Map() };
  const param = (key: string, v: number) => {
    if (!P.index.has(key)) {
      P.index.set(key, P.values.length);
      P.values.push(v);
    }
    return P.index.get(key)!;
  };
  for (const e of sketch.entities) {
    if (e.kind === "point") {
      param(`${e.id}.x`, e.x);
      param(`${e.id}.y`, e.y);
    } else if (e.kind === "circle" || e.kind === "arc") param(`${e.id}.r`, e.r);
  }
  const px = (id: Id) => [P.index.get(`${id}.x`)!, P.index.get(`${id}.y`)!] as const;
  const rr = (id: Id) => P.index.get(`${id}.r`)!;
  const res: Residual[] = [];
  const add = (params: number[], f: (v: number[]) => number) => res.push({ params, f });
  const pt = (v: number[], id: Id): Vec2 => {
    const [i, j] = px(id);
    return [v[i]!, v[j]!];
  };
  const ends = (id: Id) => {
    const l = idx.get(id);
    if (l?.kind !== "line") throw new Error(`${id} is not a line`);
    return [l.a, l.b] as const;
  };
  const lineParams = (id: Id) => ends(id).flatMap((p) => [...px(p)]);
  const dir = (v: number[], id: Id): Vec2 => {
    const [a, b] = ends(id);
    const pa = pt(v, a);
    const pb = pt(v, b);
    return [pb[0] - pa[0], pb[1] - pa[1]];
  };
  const centre = (id: Id) => {
    const e = idx.get(id)!;
    return e.kind === "circle" || e.kind === "arc" || e.kind === "ellipse" ? e.c : id;
  };
  const curveParams = (id: Id) => {
    const e = idx.get(id)!;
    return e.kind === "line" ? lineParams(id) : [...px(centre(id)), rr(id)];
  };
  const v0 = P.values;
  const distToLine = (v: number[], p: Id, l: Id) => {
    const [a] = ends(l);
    const d = dir(v, l);
    const q = pt(v, p);
    const o = pt(v, a);
    return ((q[0] - o[0]) * d[1] - (q[1] - o[1]) * d[0]) / (Math.hypot(d[0], d[1]) || 1);
  };

  for (const e of sketch.entities) {
    if (e.kind === "arc") {
      for (const end of [e.a, e.b])
        add([...px(end), ...px(e.c), rr(e.id)], (v) => Math.hypot(pt(v, end)[0] - pt(v, e.c)[0], pt(v, end)[1] - pt(v, e.c)[1]) - v[rr(e.id)]!);
    } else if (e.kind === "ellipse") {
      // Both axes are halved by the centre and cross square.
      for (const ax of [e.ax1, e.ax2]) {
        const [a, b] = ends(ax);
        for (const k of [0, 1]) add([...px(e.c), ...lineParams(ax)], (v) => pt(v, e.c)[k] - (pt(v, a)[k] + pt(v, b)[k]) / 2);
      }
      add([...lineParams(e.ax1), ...lineParams(e.ax2)], (v) => {
        const d1 = dir(v, e.ax1);
        const d2 = dir(v, e.ax2);
        return (d1[0] * d2[0] + d1[1] * d2[1]) / (Math.hypot(...d1) * Math.hypot(...d2) || 1);
      });
    }
  }

  const constraint = (c: Constraint) => {
    // As in the solver, only concentric ties to an ellipse yet.
    if (c.type !== "concentric" && constraintRefs(c).some((r) => idx.get(r)?.kind === "ellipse")) return;
    switch (c.type) {
      case "coincident":
        add([...px(c.a), ...px(c.b)], (v) => pt(v, c.a)[0] - pt(v, c.b)[0]);
        add([...px(c.a), ...px(c.b)], (v) => pt(v, c.a)[1] - pt(v, c.b)[1]);
        return;
      case "concentric": {
        const a = centre(c.a);
        const b = centre(c.b);
        add([...px(a), ...px(b)], (v) => pt(v, a)[0] - pt(v, b)[0]);
        add([...px(a), ...px(b)], (v) => pt(v, a)[1] - pt(v, b)[1]);
        return;
      }
      case "fix":
        add([px(c.p)[0]], (v) => v[px(c.p)[0]]! - v0[px(c.p)[0]]!);
        add([px(c.p)[1]], (v) => v[px(c.p)[1]]! - v0[px(c.p)[1]]!);
        return;
      case "horizontal":
      case "vertical": {
        const k = c.type === "horizontal" ? 1 : 0;
        if (c.b) {
          const [a, b] = [c.e, c.b];
          add([...px(a), ...px(b)], (v) => pt(v, a)[k] - pt(v, b)[k]);
          return;
        }
        const [a, b] = ends(c.e);
        add(lineParams(c.e), (v) => pt(v, a)[k] - pt(v, b)[k]);
        return;
      }
      case "parallel":
      case "perpendicular":
        add([...lineParams(c.a), ...lineParams(c.b)], (v) => {
          const d1 = dir(v, c.a);
          const d2 = dir(v, c.b);
          const n = Math.hypot(...d1) * Math.hypot(...d2) || 1;
          return (c.type === "parallel" ? d1[0] * d2[1] - d1[1] * d2[0] : d1[0] * d2[0] + d1[1] * d2[1]) / n;
        });
        return;
      case "pointOn": {
        const e = idx.get(c.e)!;
        if (e.kind === "line") add([...px(c.p), ...lineParams(c.e)], (v) => distToLine(v, c.p, c.e));
        else
          add([...px(c.p), ...curveParams(c.e)], (v) => Math.hypot(pt(v, c.p)[0] - pt(v, centre(c.e))[0], pt(v, c.p)[1] - pt(v, centre(c.e))[1]) - v[rr(c.e)]!);
        return;
      }
      case "tangent": {
        const a = idx.get(c.a)!;
        const b = idx.get(c.b)!;
        // Tangent where the two share an end: the radius there is square to the line (or the centres and the point
        // are in a line). The distance form is singular at a shared point, which would read as a free degree.
        const shared = (x: typeof a, y: typeof b) => {
          const ex = x.kind === "line" || x.kind === "arc" ? [x.a, x.b] : [];
          const ey = y.kind === "line" || y.kind === "arc" ? [y.a, y.b] : [];
          return ex.find((p) => ey.includes(p));
        };
        const p = shared(a, b);
        if (p && (a.kind === "line" || b.kind === "line")) {
          const [l, k] = a.kind === "line" ? [c.a, c.b] : [c.b, c.a];
          add([...lineParams(l), ...curveParams(k)], (v) => {
            const d = dir(v, l);
            const q = pt(v, p);
            const o = pt(v, centre(k));
            const r = [q[0] - o[0], q[1] - o[1]];
            return (d[0] * r[0]! + d[1] * r[1]!) / ((Math.hypot(...d) || 1) * (Math.hypot(r[0]!, r[1]!) || 1));
          });
        } else if (p) {
          add([...px(p), ...curveParams(c.a), ...curveParams(c.b)], (v) => {
            const q = pt(v, p);
            const o1 = pt(v, centre(c.a));
            const o2 = pt(v, centre(c.b));
            const u = [q[0] - o1[0], q[1] - o1[1]] as const;
            const w = [q[0] - o2[0], q[1] - o2[1]] as const;
            return (u[0] * w[1] - u[1] * w[0]) / ((Math.hypot(...u) || 1) * (Math.hypot(...w) || 1));
          });
        } else if (a.kind === "line" || b.kind === "line") {
          const [l, k] = a.kind === "line" ? [c.a, c.b] : [c.b, c.a];
          add([...lineParams(l), ...curveParams(k)], (v) => Math.abs(distToLine(v, centre(k), l)) - v[rr(k)]!);
        } else {
          const d0 = Math.hypot(pt(v0, centre(c.a))[0] - pt(v0, centre(c.b))[0], pt(v0, centre(c.a))[1] - pt(v0, centre(c.b))[1]);
          const outside = d0 >= Math.max(v0[rr(c.a)]!, v0[rr(c.b)]!);
          add([...curveParams(c.a), ...curveParams(c.b)], (v) => {
            const d = Math.hypot(pt(v, centre(c.a))[0] - pt(v, centre(c.b))[0], pt(v, centre(c.a))[1] - pt(v, centre(c.b))[1]);
            return outside ? d - v[rr(c.a)]! - v[rr(c.b)]! : d - Math.abs(v[rr(c.a)]! - v[rr(c.b)]!);
          });
        }
        return;
      }
      case "equal": {
        const a = idx.get(c.a)!;
        if (a.kind === "line") add([...lineParams(c.a), ...lineParams(c.b)], (v) => Math.hypot(...dir(v, c.a)) - Math.hypot(...dir(v, c.b)));
        else add([rr(c.a), rr(c.b)], (v) => v[rr(c.a)]! - v[rr(c.b)]!);
        return;
      }
      case "midpoint": {
        const [a, b] = ends(c.line);
        for (const k of [0, 1]) add([...px(c.p), ...lineParams(c.line)], (v) => pt(v, c.p)[k] - (pt(v, a)[k] + pt(v, b)[k]) / 2);
        return;
      }
      case "symmetric": {
        const ps = [...px(c.a), ...px(c.b), ...lineParams(c.line)];
        add(ps, (v) => {
          const m = [(pt(v, c.a)[0] + pt(v, c.b)[0]) / 2, (pt(v, c.a)[1] + pt(v, c.b)[1]) / 2];
          const [o] = ends(c.line);
          const d = dir(v, c.line);
          return ((m[0]! - pt(v, o)[0]) * d[1] - (m[1]! - pt(v, o)[1]) * d[0]) / (Math.hypot(...d) || 1);
        });
        add(ps, (v) => {
          const d = dir(v, c.line);
          return ((pt(v, c.b)[0] - pt(v, c.a)[0]) * d[0] + (pt(v, c.b)[1] - pt(v, c.a)[1]) * d[1]) / (Math.hypot(...d) || 1);
        });
        return;
      }
    }
  };

  const dimension = (d: Dimension) => {
    const [r0, r1] = d.refs as [Id, Id | undefined];
    const e0 = idx.get(r0);
    const e1 = r1 ? idx.get(r1) : undefined;
    switch (d.kind) {
      case "radius":
      case "diameter":
        add([rr(r0)], (v) => v[rr(r0)]!);
        return;
      case "angle":
        add([...lineParams(r0), ...lineParams(r1!)], (v) => {
          const a = dir(v, r0);
          const b = dir(v, r1!);
          return Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
        });
        return;
      case "length":
        if (e0?.kind === "line") {
          add(lineParams(r0), (v) => Math.hypot(...dir(v, r0)));
          return;
        }
        break;
    }
    if (e1?.kind === "line" && e0?.kind === "point") {
      add([...px(r0), ...lineParams(r1!)], (v) => distToLine(v, r0, r1!));
      return;
    }
    const [a, b] = e0?.kind === "line" ? ends(r0) : [r0, r1!];
    if (d.kind === "distanceX") add([...px(a), ...px(b)], (v) => pt(v, b)[0] - pt(v, a)[0]);
    else if (d.kind === "distanceY") add([...px(a), ...px(b)], (v) => pt(v, b)[1] - pt(v, a)[1]);
    else add([...px(a), ...px(b)], (v) => Math.hypot(pt(v, b)[0] - pt(v, a)[0], pt(v, b)[1] - pt(v, a)[1]));
  };

  for (const c of sketch.constraints) if (!c.suppressed) constraint(c);
  // A projected circle's radius is held, as the solver holds it.
  for (const e of sketch.entities) if (e.kind === "circle" && e.projectedFrom) add([rr(e.id)], (v) => v[rr(e.id)]! - v0[rr(e.id)]!);
  for (const d of sketch.dimensions) if (d.driving && !d.suppressed) dimension(d);

  // Independent groups of numbers: those linked by any residual.
  const n = P.values.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (const r of res) for (const p of r.params.slice(1)) parent[find(p)] = find(r.params[0]!);
  const groups = new Map<number, { params: number[]; res: Residual[] }>();
  for (let i = 0; i < n; i++) {
    const g = find(i);
    if (!groups.has(g)) groups.set(g, { params: [], res: [] });
    groups.get(g)!.params.push(i);
  }
  for (const r of res) groups.get(find(r.params[0]!))!.res.push(r);

  const free = new Array<boolean>(n).fill(true);
  let dof = 0;
  for (const g of groups.values()) {
    const { rank, fixedCols } = analyse(g.params, g.res, P.values);
    dof += g.params.length - rank;
    g.params.forEach((p, i) => (free[p] = !fixedCols[i]));
  }

  const fixed = new Set<Id>();
  const isFixed = (key: string) => {
    const i = P.index.get(key);
    return i === undefined || !free[i];
  };
  const pointFixed = (id: Id) => isFixed(`${id}.x`) && isFixed(`${id}.y`);
  for (const e of sketch.entities) {
    const ok =
      e.kind === "point"
        ? pointFixed(e.id)
        : e.kind === "line"
          ? pointFixed(e.a) && pointFixed(e.b)
          : e.kind === "circle"
            ? pointFixed(e.c) && isFixed(`${e.id}.r`)
            : e.kind === "ellipse"
              ? pointFixed(e.c) && [e.ax1, e.ax2].every((ax) => ends(ax).every(pointFixed))
              : pointFixed(e.c) && pointFixed(e.a) && pointFixed(e.b) && isFixed(`${e.id}.r`);
    if (ok) fixed.add(e.id);
  }
  return { dof, fixed };
}

/** Rank of the group's Jacobian, and which of its columns no null-space vector moves. */
function analyse(params: number[], res: Residual[], values: number[]): { rank: number; fixedCols: boolean[] } {
  const cols = params.length;
  const col = new Map(params.map((p, i) => [p, i]));
  const h = 1e-6;
  const J: number[][] = res.map((r) => {
    const row = new Array<number>(cols).fill(0);
    const v = values.slice();
    for (const p of new Set(r.params)) {
      const keep = v[p]!;
      v[p] = keep + h;
      const fp = r.f(v);
      v[p] = keep - h;
      const fm = r.f(v);
      v[p] = keep;
      row[col.get(p)!] = (fp - fm) / (2 * h);
    }
    return row;
  });
  // Reduced row echelon form with partial pivoting.
  const tol = 1e-7;
  const pivots: number[] = [];
  let r = 0;
  for (let c = 0; c < cols && r < J.length; c++) {
    let best = r;
    for (let i = r + 1; i < J.length; i++) if (Math.abs(J[i]![c]!) > Math.abs(J[best]![c]!)) best = i;
    if (Math.abs(J[best]![c]!) < tol) continue;
    [J[r], J[best]] = [J[best]!, J[r]!];
    const pr = J[r]!;
    const pv = pr[c]!;
    for (let k = c; k < cols; k++) pr[k]! /= pv;
    for (let i = 0; i < J.length; i++) {
      if (i === r) continue;
      const f = J[i]![c]!;
      if (Math.abs(f) < 1e-15) continue;
      const row = J[i]!;
      for (let k = c; k < cols; k++) row[k]! -= f * pr[k]!;
    }
    pivots.push(c);
    r++;
  }
  // Null space: one vector per free column. A pivot column is fixed when every free column's entry in its row is ~0.
  const isPivot = new Array<boolean>(cols).fill(false);
  pivots.forEach((c) => (isPivot[c] = true));
  const fixedCols = new Array<boolean>(cols).fill(false);
  pivots.forEach((c, row) => {
    let moves = false;
    for (let k = 0; k < cols && !moves; k++) if (!isPivot[k] && Math.abs(J[row]![k]!) > 1e-6) moves = true;
    fixedCols[c] = !moves;
  });
  return { rank: pivots.length, fixedCols };
}
