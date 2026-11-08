import { Algorithm, SolveStatus, init_planegcs_module, GcsWrapper, type SketchPrimitive } from "@salusoft89/planegcs";
import { SketchIndex, type Constraint, type Dimension, type Id, type Sketch, type Vec2 } from "./model";
import { angleOf, cross, dot, sub } from "./geom2d";
import { freedom } from "./dof";
import { measureDimension } from "./measure";

/**
 * planegcs (FreeCAD's sketch solver, LGPL, WASM, shipped unmodified) behind one small interface (#58). The sketch model
 * is mapped to planegcs primitives on every solve (sketches are small; a 200-entity sketch maps and solves in a few
 * ms), solved with DogLeg, then Levenberg-Marquardt if that fails, and the positions are written back.
 */
export type SolveStatusName = "ok" | "conflicting" | "redundant" | "failed";

export interface SolveResult {
  status: SolveStatusName;
  /** The sketch with solved positions and driven dimensions measured. Unchanged when the solve failed. */
  sketch: Sketch;
  /** Degrees of freedom left. 0 is fully constrained. */
  dof: number;
  /** Entities whose position is fully set by constraints. */
  fixed: Set<Id>;
  /** Constraint and dimension ids that fight each other (smallest set planegcs finds). */
  conflicting: Id[];
  /** Constraint and dimension ids that repeat what others already say. */
  redundant: Id[];
  ms: number;
}

const DEG = Math.PI / 180;

export class Solver {
  private constructor(private w: GcsWrapper) {}

  /** Loads the WASM. In the browser pass its URL; in Node it is found beside the glue. */
  static async load(wasmUrl?: string): Promise<Solver> {
    const module = await init_planegcs_module(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
    return new Solver(new GcsWrapper(new module.GcsSystem(), module));
  }

  solve(sketch: Sketch): SolveResult {
    return this.run(sketch, []);
  }

  /** Moves a point toward `to` as far as the constraints allow (dragging with the Select tool). */
  drag(sketch: Sketch, pointId: Id, to: [number, number]): SolveResult {
    return this.run(sketch, [
      { id: "#drag-x", type: "coordinate_x", p_id: pointId, x: to[0], temporary: true },
      { id: "#drag-y", type: "coordinate_y", p_id: pointId, y: to[1], temporary: true },
    ]);
  }

  /**
   * Moves several points toward targets at once, as far as the constraints allow. The targets are soft: planegcs
   * meets the sketch's constraints first and gets the points as near their targets as those allow.
   */
  dragPoints(sketch: Sketch, targets: [Id, Vec2][]): SolveResult {
    return this.run(
      sketch,
      targets.flatMap(([p, [x, y]], i): SketchPrimitive[] => [
        { id: `#drag-x${i}`, type: "coordinate_x", p_id: p, x, temporary: true },
        { id: `#drag-y${i}`, type: "coordinate_y", p_id: p, y, temporary: true },
      ]),
    );
  }

  private run(sketch: Sketch, extra: SketchPrimitive[]): SolveResult {
    const t0 = performance.now();
    const w = this.w;
    w.clear_data();
    w.push_primitives_and_params([...toPrimitives(sketch), ...extra]);
    let code = w.solve(Algorithm.DogLeg);
    if (code === SolveStatus.Failed) code = w.solve(Algorithm.LevenbergMarquardt);
    const owner = (id: string) => id.split("#")[0]!;
    const conflicting = [...new Set(w.get_gcs_conflicting_constraints().map(owner))].filter(Boolean);
    const redundant = [...new Set(w.get_gcs_redundant_constraints().map(owner))].filter(Boolean);
    const failed = code === SolveStatus.Failed || code === SolveStatus.SuccessfulSolutionInvalid;
    const status: SolveStatusName = conflicting.length ? "conflicting" : redundant.length ? "redundant" : failed ? "failed" : "ok";

    let solved = sketch;
    if (status === "ok" || status === "redundant") {
      w.apply_solution();
      const idx = w.sketch_index;
      solved = {
        ...sketch,
        entities: sketch.entities.map((e) => {
          const p = idx.get_primitive(e.id);
          if (!p) return e;
          if (e.kind === "point" && p.type === "point") return { ...e, x: p.x, y: p.y };
          if ((e.kind === "circle" && p.type === "circle") || (e.kind === "arc" && p.type === "arc")) return { ...e, r: p.radius };
          return e;
        }),
      };
      solved = { ...solved, dimensions: solved.dimensions.map((d) => (d.driving && !d.suppressed ? d : { ...d, value: measureDimension(solved, d) })) };
    }
    const f = freedom(solved);
    return { status, sketch: solved, dof: f.dof, fixed: f.fixed, conflicting, redundant, ms: performance.now() - t0 };
  }
}

/** The sketch as planegcs primitives. Ids carry over; a constraint that maps to several gets `#n` suffixes. */
export function toPrimitives(sketch: Sketch): SketchPrimitive[] {
  const idx = new SketchIndex(sketch);
  const fixed = new Set(sketch.constraints.filter((c) => c.type === "fix" && !c.suppressed).map((c) => (c as { p: Id }).p));
  const out: SketchPrimitive[] = [];
  for (const e of sketch.entities) {
    if (e.kind === "point") out.push({ id: e.id, type: "point", x: e.x, y: e.y, fixed: fixed.has(e.id) });
  }
  for (const e of sketch.entities) {
    if (e.kind === "line") out.push({ id: e.id, type: "line", p1_id: e.a, p2_id: e.b });
    else if (e.kind === "circle") out.push({ id: e.id, type: "circle", c_id: e.c, radius: e.r });
    else if (e.kind === "arc") {
      const c = idx.xy(e.c);
      const a0 = angleOf(sub(idx.xy(e.a), c));
      let a1 = angleOf(sub(idx.xy(e.b), c));
      if (a1 <= a0) a1 += 2 * Math.PI;
      out.push({ id: e.id, type: "arc", c_id: e.c, start_id: e.a, end_id: e.b, start_angle: a0, end_angle: a1, radius: e.r });
      out.push({ id: `${e.id}#rules`, type: "arc_rules", a_id: e.id });
    }
  }
  for (const c of sketch.constraints) if (!c.suppressed) out.push(...constraintPrimitives(c, idx));
  for (const d of sketch.dimensions) if (d.driving && !d.suppressed) out.push(...dimensionPrimitives(d, idx));
  return out;
}

function constraintPrimitives(c: Constraint, idx: SketchIndex): SketchPrimitive[] {
  const kind = (id: Id) => idx.get(id)?.kind;
  const centre = (id: Id) => {
    const e = idx.get(id)!;
    return e.kind === "circle" || e.kind === "arc" ? e.c : id;
  };
  const id = c.id;
  switch (c.type) {
    case "coincident":
      return [{ id, type: "p2p_coincident", p1_id: c.a, p2_id: c.b }];
    case "pointOn": {
      const k = kind(c.e);
      if (k === "line") return [{ id, type: "point_on_line_pl", p_id: c.p, l_id: c.e }];
      if (k === "circle") return [{ id, type: "point_on_circle", p_id: c.p, c_id: c.e }];
      return [{ id, type: "point_on_arc", p_id: c.p, a_id: c.e }];
    }
    case "horizontal":
      return c.b ? [{ id, type: "horizontal_pp", p1_id: c.e, p2_id: c.b }] : [{ id, type: "horizontal_l", l_id: c.e }];
    case "vertical":
      return c.b ? [{ id, type: "vertical_pp", p1_id: c.e, p2_id: c.b }] : [{ id, type: "vertical_l", l_id: c.e }];
    case "parallel":
      return [{ id, type: "parallel", l1_id: c.a, l2_id: c.b }];
    case "perpendicular":
      return [{ id, type: "perpendicular_ll", l1_id: c.a, l2_id: c.b }];
    case "tangent": {
      const [a, b] = [kind(c.a), kind(c.b)];
      // Curves that share an end are tangent at that point: their directions there agree (or are opposite). The
      // distance form is singular at a shared point and reads as redundant once solved.
      const p = sharedEnd(idx, c.a, c.b);
      if (p) return [{ id, type: "angle_via_point", crv1_id: c.a, crv2_id: c.b, p_id: p, angle: endTurn(idx, c.a, c.b, p) }];
      if (a === "line" || b === "line") {
        const [l, k] = a === "line" ? [c.a, c.b] : [c.b, c.a];
        return kind(k) === "circle" ? [{ id, type: "tangent_lc", l_id: l, c_id: k }] : [{ id, type: "tangent_la", l_id: l, a_id: k }];
      }
      if (a === "circle" && b === "circle") return [{ id, type: "tangent_cc", c1_id: c.a, c2_id: c.b }];
      if (a === "arc" && b === "arc") return [{ id, type: "tangent_aa", a1_id: c.a, a2_id: c.b }];
      const [circ, arc] = a === "circle" ? [c.a, c.b] : [c.b, c.a];
      return [{ id, type: "tangent_ca", c_id: circ, a_id: arc }];
    }
    case "equal": {
      const [a, b] = [kind(c.a), kind(c.b)];
      if (a === "line") return [{ id, type: "equal_length", l1_id: c.a, l2_id: c.b }];
      if (a === "circle" && b === "circle") return [{ id, type: "equal_radius_cc", c1_id: c.a, c2_id: c.b }];
      if (a === "arc" && b === "arc") return [{ id, type: "equal_radius_aa", a1_id: c.a, a2_id: c.b }];
      const [circ, arc] = a === "circle" ? [c.a, c.b] : [c.b, c.a];
      return [{ id, type: "equal_radius_ca", c1_id: circ, a2_id: arc }];
    }
    case "concentric":
      return [{ id, type: "p2p_coincident", p1_id: centre(c.a), p2_id: centre(c.b) }];
    case "midpoint": {
      const l = idx.get(c.line);
      if (l?.kind !== "line") return [];
      return [{ id, type: "p2p_symmetric_ppp", p1_id: l.a, p2_id: l.b, p_id: c.p }];
    }
    case "fix":
      // Fixed points are pushed as fixed parameters.
      return [];
    case "symmetric":
      return [{ id, type: "p2p_symmetric_ppl", p1_id: c.a, p2_id: c.b, l_id: c.line }];
  }
}

/** The point two lines or arcs both end on, if any. */
function sharedEnd(idx: SketchIndex, a: Id, b: Id): Id | undefined {
  const ends = (id: Id) => {
    const e = idx.get(id);
    return e?.kind === "line" || e?.kind === "arc" ? [e.a, e.b] : [];
  };
  const eb = ends(b);
  return ends(a).find((p) => eb.includes(p));
}

/** 0 or π: whether the two curves' directions at their shared point run the same way now. */
function endTurn(idx: SketchIndex, a: Id, b: Id, p: Id): number {
  const tangent = (id: Id): [number, number] => {
    const e = idx.get(id)!;
    if (e.kind === "line") return sub(idx.xy(e.b), idx.xy(e.a));
    const r = sub(idx.xy(p), idx.xy((e as { c: Id }).c));
    return [-r[1], r[0]];
  };
  return dot(tangent(a), tangent(b)) >= 0 ? 0 : Math.PI;
}

function dimensionPrimitives(d: Dimension, idx: SketchIndex): SketchPrimitive[] {
  const id = d.id;
  const [r0, r1] = d.refs as [Id, Id | undefined];
  const e0 = idx.get(r0);
  const e1 = r1 ? idx.get(r1) : undefined;
  switch (d.kind) {
    case "radius":
      return [e0?.kind === "arc" ? { id, type: "arc_radius", a_id: r0, radius: d.value } : { id, type: "circle_radius", c_id: r0, radius: d.value }];
    case "diameter":
      return [e0?.kind === "arc" ? { id, type: "arc_diameter", a_id: r0, diameter: d.value } : { id, type: "circle_diameter", c_id: r0, diameter: d.value }];
    case "angle": {
      // Keep the turn's current sense, so 30° does not flip the line to -30°.
      const l0 = idx.get(r0);
      const l1 = idx.get(r1!);
      if (l0?.kind !== "line" || l1?.kind !== "line") return [];
      const u = sub(idx.xy(l0.b), idx.xy(l0.a));
      const v = sub(idx.xy(l1.b), idx.xy(l1.a));
      const sign = Math.atan2(cross(u, v), dot(u, v)) < 0 ? -1 : 1;
      return [{ id, type: "l2l_angle_ll", l1_id: r0, l2_id: r1!, angle: sign * d.value * DEG }];
    }
    default:
      break;
  }
  if (e0?.kind === "point" && e1?.kind === "line") return [{ id, type: "p2l_distance", p_id: r0, l_id: r1!, distance: d.value }];
  const [a, b] = e0?.kind === "line" ? [e0.a, e0.b] : [r0, r1!];
  if (d.kind === "distanceX" || d.kind === "distanceY") {
    const prop = d.kind === "distanceX" ? "x" : "y";
    const k = prop === "x" ? 0 : 1;
    const sign = idx.xy(b)[k] < idx.xy(a)[k] ? -1 : 1;
    return [{ id, type: "difference", param1: { o_id: a, prop }, param2: { o_id: b, prop }, difference: sign * d.value }];
  }
  return [{ id, type: "p2p_distance", p1_id: a, p2_id: b, distance: d.value }];
}
