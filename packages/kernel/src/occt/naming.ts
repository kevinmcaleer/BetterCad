import type { TopoDS_Shape } from "replicad-opencascadejs";
import type { OC } from "./oc";
import { edgeNumbering, elements, shapesOfList, type History, type Tracker } from "./shapes";

/**
 * Topological naming (#47): every face of a body gets a name from how it was made, so a step that picks edges or
 * faces (fillet, chamfer, shell, push/pull) finds the same ones again when an earlier step changes. See
 * docs/topological-naming.md.
 *
 * - An extruded or revolved face is named by the sketch curve it was swept from, `side(<curve id>)`, and its ends
 *   `cap.start` and `cap.end`. A primitive's faces are `f<n>` in OpenCascade's fixed order.
 * - A tool's faces carry the step's id: `<step>:side(l3)`.
 * - Joins, cuts, fillets and shells carry names through OpenCascade's history (`Modified`, `Generated`,
 *   `IsDeleted`). A face rounded from an edge is `fillet(<edge>)` (or `chamfer(…)`); a shell's inner wall is
 *   `shell(<face>)`. A face split in two becomes `name#1`, `name#2`, ordered by where its middle is.
 * - An edge is named by the faces either side of it, `a|b`, again with `#k` when two edges share both faces.
 */

/** Past this many faces naming stops for the body (imports, catalogue parts), and steps fall back to numbers. */
export const NAMING_LIMIT = 600;

const shapesOf = shapesOfList;

type V3 = [number, number, number];

const middle = (oc: OC, s: TopoDS_Shape, kind: "face" | "edge"): V3 => {
  const props = new oc.GProp_GProps();
  if (kind === "face") oc.BRepGProp.SurfaceProperties(s, props, false, false);
  else oc.BRepGProp.LinearProperties(s, props, false, false);
  const c = props.CentreOfMass();
  const out: V3 = [c.X(), c.Y(), c.Z()];
  props.delete();
  return out;
};

/** Orders points by x, then y, then z, a tenth of a micron apart counting as level. */
const byPlace = (a: V3, b: V3) => {
  for (let i = 0; i < 3; i++) {
    const d = a[i]! - b[i]!;
    if (Math.abs(d) > 1e-4) return d;
  }
  return 0;
};

/** Gives repeated names `#1`, `#2`… in order of where each element's middle is. */
function distinct(oc: OC, names: string[], els: TopoDS_Shape[], kind: "face" | "edge"): string[] {
  const groups = new Map<string, number[]>();
  names.forEach((n, i) => {
    const g = groups.get(n);
    if (g) g.push(i);
    else groups.set(n, [i]);
  });
  const out = [...names];
  for (const [n, g] of groups) {
    if (g.length < 2) continue;
    const at = new Map(g.map((i) => [i, middle(oc, els[i]!, kind)]));
    g.sort((a, b) => byPlace(at.get(a)!, at.get(b)!) || a - b).forEach((i, k) => (out[i] = `${n}#${k + 1}`));
  }
  return out;
}

/** Edge names from face names: the sorted names of the faces either side, or `seam(face)` for a face's own seam. */
export function edgeNames(oc: OC, shape: TopoDS_Shape, faceNames: string[], edges = elements(oc, shape, "edge")): string[] {
  const num = edgeNumbering(oc, edges);
  const sides: Set<string>[] = edges.map(() => new Set());
  elements(oc, shape, "face").forEach((f, i) => {
    const ex = new oc.TopExp_Explorer(f, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) {
      const k = num(ex.Current());
      if (k >= 0) sides[k]!.add(faceNames[i] ?? `f${i}`);
    }
    ex.delete();
  });
  const names = sides.map((s) => {
    const u = [...s].sort();
    return u.length === 1 ? `seam(${u[0]})` : u.length ? u.join("|") : "edge";
  });
  return distinct(oc, names, edges, "edge");
}

const SUFFIX = /#(\d+)$/;

export interface Resolved {
  refs: number[];
  /** Some names were not found as they were, so the step may now be on the wrong edges or faces. */
  recovered: boolean;
}

/**
 * Finds stored names among the current ones: the same name; else the same name before a split (`a#2` → the 2nd of the
 * faces now called `a#…`, or `a` itself); else the number the step was picked with.
 */
export function resolveNames(stored: string[], current: string[], fallback: number[] = []): Resolved {
  const refs: number[] = [];
  let recovered = false;
  const at = new Map<string, number>();
  current.forEach((n, i) => at.set(n, i));
  stored.forEach((n, i) => {
    let j = at.get(n);
    if (j === undefined) {
      recovered = true;
      const k = Number(SUFFIX.exec(n)?.[1] ?? 1);
      const base = n.replace(SUFFIX, "");
      const like = current.flatMap((c, ci) => (c === base || c.replace(SUFFIX, "") === base ? [ci] : []));
      j = like.length ? like[Math.min(k, like.length) - 1] : fallback[i];
    }
    if (j !== undefined && j >= 0 && j < current.length && !refs.includes(j)) refs.push(j);
  });
  return { refs, recovered };
}

/**
 * Follows face names through the steps that make one body. Shapes it has named are kept with their names; a shape it
 * hasn't seen (a slab, a hole's tool, a grown body) is named by face number under `prefix`.
 */
export class Namer implements Tracker {
  private known: { shape: TopoDS_Shape; faces: string[]; els?: TopoDS_Shape[] }[] = [];
  /** Put before names of shapes made fresh by the current step: its id, so a tool's faces differ from the body's. */
  prefix = "";
  /** Set when a body has too many faces to follow; from then on nothing is named. */
  off = false;

  constructor(private oc: OC) {}

  /** Names a shape's faces (in `elements` order). */
  add(shape: TopoDS_Shape, faces: string[], els?: TopoDS_Shape[]): void {
    if (this.off) return;
    this.known.push({ shape, faces, els });
    // Only the last few matter: the body so far and the tools of the step being made.
    if (this.known.length > 24) this.known.shift();
  }

  /** A shape's faces, kept from when it was named so a long run of cuts doesn't list them twice. */
  private facesOf(shape: TopoDS_Shape): TopoDS_Shape[] {
    for (let i = this.known.length - 1; i >= 0; i--) {
      const k = this.known[i]!;
      if (k.els && k.shape.IsSame(shape)) return k.els;
    }
    return elements(this.oc, shape, "face");
  }

  /** The names of a shape's faces, or null when it isn't known. */
  find(shape: TopoDS_Shape): string[] | null {
    for (let i = this.known.length - 1; i >= 0; i--) if (this.known[i]!.shape.IsSame(shape)) return this.known[i]!.faces;
    return null;
  }

  /** The names of a shape's faces: as known, or by number under the prefix. */
  namesOf(shape: TopoDS_Shape, faces = elements(this.oc, shape, "face")): string[] {
    const k = this.find(shape);
    if (k) return k;
    const names = faces.map((_, i) => `${this.prefix}f${i}`);
    this.add(shape, names);
    return names;
  }

  /** A moved or mirrored copy has the same faces in the same order: the same names. */
  moved(to: TopoDS_Shape, from: TopoDS_Shape): void {
    const k = this.find(from);
    if (k) this.add(to, k);
  }

  /** Too many faces to follow: stop. */
  private check(n: number): boolean {
    if (n > NAMING_LIMIT) {
      this.off = true;
      this.known = [];
    }
    return !this.off;
  }

  sweep(mk: History & { FirstShape(): TopoDS_Shape; LastShape(): TopoDS_Shape }, out: TopoDS_Shape, edges: [TopoDS_Shape, string][]): void {
    const oc = this.oc;
    const faces = elements(oc, out, "face");
    if (!this.check(faces.length)) return;
    const names: (string | null)[] = faces.map(() => null);
    const give = (s: TopoDS_Shape, n: string) => {
      const i = faces.findIndex((f) => f.IsSame(s));
      if (i >= 0 && names[i] === null) names[i] = this.prefix + n;
    };
    for (const [e, n] of edges) for (const g of shapesOf(oc, mk.Generated(e))) give(g, `side(${n})`);
    give(mk.FirstShape(), "cap.start");
    give(mk.LastShape(), "cap.end");
    this.add(
      out,
      distinct(
        oc,
        names.map((n, i) => n ?? `${this.prefix}f${i}`),
        faces,
        "face",
      ),
      faces,
    );
  }

  step(mk: History, inputs: TopoDS_Shape[], out: TopoDS_Shape, made?: { word: string; offset?: boolean }): void {
    if (this.off) return;
    const oc = this.oc;
    const faces = elements(oc, out, "face");
    if (!this.check(faces.length)) return;
    const names: (string | null)[] = faces.map(() => null);
    // Most faces keep their place in the list, so look there first.
    const index = (s: TopoDS_Shape, guess = -1) => (faces[guess]?.IsSame(s) ? guess : faces.findIndex((f) => f.IsSame(s)));
    const give = (i: number, n: string) => {
      if (i >= 0 && names[i] === null) names[i] = n;
    };
    // Faces first, in input order, so a face two inputs made (a join's merged faces) keeps the body's name.
    const inputs2 = inputs.map((s) => {
      const fs = this.facesOf(s);
      return { s, fs, names: this.namesOf(s, fs) };
    });
    for (const { fs, names: n } of inputs2) {
      fs.forEach((f, j) => {
        const name = n[j]!;
        const kept = index(f, j);
        if (kept >= 0) return give(kept, name);
        if (mk.IsDeleted(f)) return;
        for (const m of shapesOf(oc, mk.Modified(f))) give(index(m), made?.offset ? `${made.word}(${name})` : name);
      });
    }
    // Then faces made from edges and corners: a fillet's rounds, a chamfer's bevels.
    if (made) {
      for (const { s, names: n } of inputs2) {
        const edges = elements(oc, s, "edge");
        const en = edgeNames(oc, s, n, edges);
        edges.forEach((e, j) => {
          for (const g of shapesOf(oc, mk.Generated(e))) give(index(g), `${made.word}(${en[j]})`);
        });
        elements(oc, s, "vertex").forEach((v) => {
          const gs = shapesOf(oc, mk.Generated(v));
          gs.forEach((g) => give(index(g), `${this.prefix}${made.word}.corner`));
        });
      }
    }
    this.add(
      out,
      distinct(
        oc,
        names.map((n) => n ?? `${this.prefix}new`),
        faces,
        "face",
      ),
      faces,
    );
  }
}
