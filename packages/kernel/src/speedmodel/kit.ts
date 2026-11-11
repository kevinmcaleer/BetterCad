import { Draft, filletCorner, type Frame, type PlaneRef, type Sketch, type Vec2 } from "@bettercad/sketch";
import {
  addCombine,
  addConstruct,
  addExtrude,
  addFinish,
  addHole,
  addLoft,
  addPattern,
  addRevolve,
  addSketch,
  addSweep,
  newDoc,
  updateSketch,
  type ConstructParams,
  type ExtrudeParams,
  type FinishParams,
  type HoleStepParams,
  type LoftParams,
  type ModelDoc,
  type PatternParams,
  type RevolveParams,
  type SweepParams,
  type PartKind,
  type Vec3,
} from "../document";
import type { BodyMesh } from "../mesh";
import { ModelBuilder } from "../occt/model";
import type { OC } from "../occt/oc";

/**
 * A small kit for writing speed-modelling parts (Too Tall Toby and the like) as BetterCad timelines: the same steps a
 * person takes in the app (sketch, extrude, revolve, loft, fillet, hole, mirror), with stable ids so the files only change
 * when the model does. No step here does anything the app's tools can't.
 */
export class Timeline {
  doc: ModelDoc;
  private n = 0;
  constructor(
    name: string,
    private oc?: OC,
  ) {
    this.doc = newDoc(name);
  }
  private id(prefix: string) {
    return `${prefix}${++this.n}`;
  }
  /** A sketch on a plane, drawn with the Draft helpers below. */
  sketch(plane: PlaneRef, draw: (d: Draft) => void): string {
    const id = this.id("s");
    this.doc = addSketch(this.doc, plane, id);
    this.doc = updateSketch(this.doc, id, (s: Sketch) => {
      const d = new Draft(s);
      draw(d);
      return d.done().sketch;
    });
    return id;
  }
  extrude(p: Omit<ExtrudeParams, "direction"> & { direction?: ExtrudeParams["direction"] }): string {
    const body = this.id("b");
    this.doc = addExtrude(this.doc, { direction: "one", ...p }, this.id("x"), body);
    return body;
  }
  revolve(p: RevolveParams): string {
    const body = this.id("b");
    this.doc = addRevolve(this.doc, p, this.id("r"), body);
    return body;
  }
  loft(p: LoftParams): string {
    const body = this.id("b");
    this.doc = addLoft(this.doc, p, this.id("l"), body);
    return body;
  }
  sweep(p: SweepParams): string {
    const body = this.id("b");
    this.doc = addSweep(this.doc, p, this.id("w"), body);
    return body;
  }
  finish(p: FinishParams) {
    this.doc = addFinish(this.doc, p, this.id("f"));
  }
  hole(p: HoleStepParams) {
    this.doc = addHole(this.doc, p, this.id("h"));
  }
  pattern(p: Partial<PatternParams> & Pick<PatternParams, "parts" | "kind">) {
    this.doc = addPattern(this.doc, p, this.id("m"));
  }
  combine(target: string, tools: string[], op: "join" | "cut" | "intersect" = "join") {
    this.doc = addCombine(this.doc, { mode: "combine", target, tools: tools.map((id) => ({ id, op })) }, this.id("c"));
  }
  construct(p: ConstructParams): string {
    const id = this.id("k");
    this.doc = addConstruct(this.doc, p, id);
    return id;
  }
  /**
   * A body's edges as they stand at the end of the timeline so far, picked by where they run: what a person clicks on.
   * Builds the model to find them, as the app shows it.
   */
  edges(body: string, test: (p: [number, number, number]) => boolean): number[] {
    if (!this.oc) throw new Error("Give the timeline the kernel to pick edges");
    const r = new ModelBuilder(this.oc).build(this.doc);
    const b = r.bodies.find((x) => x.id === body);
    if (!b) throw new Error(`No body ${body}: ${JSON.stringify(r.failed)}`);
    const picked = edgesWhere(b.mesh, test);
    if (!picked.length) throw new Error(`No edges of ${body} there`);
    return picked;
  }
  /** A Library shape (box, cylinder...): `at` is its bottom centre, as the app places them. */
  shape(kind: PartKind, size: Vec3, at: Vec3): string {
    const id = this.id("b");
    this.doc = {
      ...this.doc,
      features: [...this.doc.features, { id: this.id("a"), type: "add", name: `Add ${kind}`, part: { id, name: kind, kind, position: at, size } }],
    };
    return id;
  }
  /** The id of the last step, for steps that pick other steps. */
  get last(): string {
    return this.doc.features[this.doc.features.length - 1]!.id;
  }
}

export const world = (plane: "XY" | "XZ" | "YZ", offset = 0): PlaneRef => ({ kind: "world", plane, offset });

/** One step of a closed outline: a corner, or an arc round `c` to the next corner (anticlockwise unless `cw`). */
export type Step = Vec2 | { arc: Vec2; cw?: boolean; to: Vec2 };

/**
 * A closed outline of lines and arcs, as the Line tool draws it with arcs dropped in: corners are shared points. Each
 * arc step runs from the corner before it to its `to` corner.
 */
export function outline(d: Draft, start: Vec2, steps: Step[]) {
  const first = d.point(start);
  let prev = first;
  steps.forEach((s, i) => {
    const lastStep = i === steps.length - 1;
    const end = Array.isArray(s) ? s : s.to;
    const next = lastStep && near(end, start) ? first : d.point(end);
    if (Array.isArray(s)) d.line(prev, next);
    else if (s.cw) d.arc(s.arc, next, prev);
    else d.arc(s.arc, prev, next);
    prev = next;
  });
  if (prev !== first) d.line(prev, first);
}

const near = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9;

/** A rectangle by its centre and size. */
export function rect(d: Draft, c: Vec2, w: number, h: number) {
  outline(
    d,
    [c[0] - w / 2, c[1] - h / 2],
    [
      [c[0] + w / 2, c[1] - h / 2],
      [c[0] + w / 2, c[1] + h / 2],
      [c[0] - w / 2, c[1] + h / 2],
    ],
  );
}

/** A rectangle with every corner rounded to `r`. */
export function roundedRect(d: Draft, c: Vec2, w: number, h: number, r: number) {
  const [x0, x1, y0, y1] = [c[0] - w / 2, c[0] + w / 2, c[1] - h / 2, c[1] + h / 2];
  outline(
    d,
    [x0 + r, y0],
    [
      [x1 - r, y0],
      { arc: [x1 - r, y0 + r], to: [x1, y0 + r] },
      [x1, y1 - r],
      { arc: [x1 - r, y1 - r], to: [x1 - r, y1] },
      [x0 + r, y1],
      { arc: [x0 + r, y1 - r], to: [x0, y1 - r] },
      [x0, y0 + r],
      { arc: [x0 + r, y0 + r], to: [x0 + r, y0] },
    ],
  );
}

/** A slot (stadium) by its centre, overall length and width, turned `deg` from the sketch's X. */
export function slot(d: Draft, c: Vec2, length: number, width: number, deg = 0) {
  const r = width / 2;
  const h = length / 2 - r;
  const t = (deg * Math.PI) / 180;
  const at = (u: number, v: number): Vec2 => [c[0] + u * Math.cos(t) - v * Math.sin(t), c[1] + u * Math.sin(t) + v * Math.cos(t)];
  outline(d, at(-h, -r), [at(h, -r), { arc: at(h, 0), to: at(h, r) }, at(-h, r), { arc: at(-h, 0), to: at(-h, -r) }]);
}

/** Edges of a built body whose every drawn point passes `test`, by the kernel's edge numbers. */
export function edgesWhere(mesh: BodyMesh, test: (p: [number, number, number]) => boolean): number[] {
  const out: number[] = [];
  const s = mesh.edgeSegs;
  const e = mesh.edgePositions;
  for (let i = 0; i + 1 < s.length; i++) {
    let ok = s[i + 1]! > s[i]!;
    for (let k = s[i]!; ok && k < s[i + 1]!; k++) for (const o of [0, 3]) if (!test([e[k * 6 + o]!, e[k * 6 + o + 1]!, e[k * 6 + o + 2]!])) ok = false;
    if (ok) out.push(i);
  }
  return out;
}

/** A face's frame for the Hole tool: origin on the face, normal out of the body. */
export const frame = (origin: [number, number, number], normal: [number, number, number], x: [number, number, number]): Frame => ({ origin, normal, x });

/** The R`r` round where an outline turns at `corner`, coming from `from` and going on to `to`: the steps for it. */
export function roundCorner(from: Vec2, corner: Vec2, to: Vec2, r: number): Step[] {
  const f = filletCorner(corner, from, to, r);
  if (!f) throw new Error(`No R${r} round fits at ${corner}`);
  return [f.ta, { arc: f.c, cw: !f.ccw, to: f.tb }];
}

export const near0 = (v: number, want: number, tol = 1e-3) => Math.abs(v - want) < tol;

export const DENSITY = { steel: 7.8e-3, aluminium: 2.7e-3, abs: 1.02e-3 } as const;
