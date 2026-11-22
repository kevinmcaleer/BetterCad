import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./oc";
import { boolean, box, cylinder, elements, fillet, place, type TopoDS_Shape } from "./shapes";
import { ModelBuilder } from "./model";
import { SAMPLES } from "../samples";
import { distanceTo, pointsOn, projectView, viewAxes, VIEWS, type ViewCurve, type ViewEdge } from "./project";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

/** A 30 × 20 × 10 block with a 6 mm hole down through it at (5, 3). */
const drilled = (): TopoDS_Shape =>
  boolean(oc, "cut", box(oc, { x: 30, y: 20, z: 10 }), [place(oc, cylinder(oc, { x: 6, y: 6, z: 20 }), { position: { x: 5, y: 3, z: -5 } })]);

const of = (edges: ViewEdge[], kind: ViewCurve["kind"], visible?: boolean) =>
  edges.filter((e) => e.curve.kind === kind && (visible === undefined || e.visible === visible));

describe("view axes", () => {
  it("puts the model's X to the right and Z up in the front view", () => {
    expect(viewAxes(VIEWS.front)).toEqual({ x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0] });
  });
  it("puts X to the right and Y up in the top view", () => {
    const a = viewAxes(VIEWS.top);
    expect(a.x).toEqual([1, 0, 0]);
    expect(a.y).toEqual([0, 1, 0]);
  });
});

describe("projectView", () => {
  it("gives a hole seen end on as one whole circle, traced to its rim", () => {
    const shape = drilled();
    const view = projectView(oc, [shape], VIEWS.top);
    expect(view.box).toEqual({ min: [-15, -10], max: [15, 10] });
    // Four sides and the hole: the bottom face's edges lie straight behind and are given once.
    expect(view.edges).toHaveLength(5);
    const [hole] = of(view.edges, "circle");
    expect(hole).toMatchObject({ visible: true, type: "sharp", curve: { c: [5, 3], r: 3 } });
    // The rim it names is a circle of that size at the top of the block.
    const rim = elements(oc, shape, "edge")[hole!.from!.edge!]!;
    const c = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(rim));
    expect(c.GetType()).toBe(oc.GeomAbs_CurveType.GeomAbs_Circle);
    expect(c.Value(0).Z()).toBeCloseTo(10);
    c.delete();
  });

  it("gives a hole seen side on as two hidden lines, traced to the hole's wall", () => {
    const shape = drilled();
    const view = projectView(oc, [shape], VIEWS.front);
    const visible = view.edges.filter((e) => e.visible);
    expect(visible).toHaveLength(4);
    expect(visible.every((e) => e.curve.kind === "line" && e.type === "sharp" && e.from?.edge !== undefined)).toBe(true);
    const hidden = view.edges.filter((e) => !e.visible);
    expect(hidden.map((e) => (e.curve as { a: number[] }).a[0]).sort()).toEqual([2, 8]);
    expect(hidden.every((e) => e.type === "outline")).toBe(true);
    // Both name the one round face.
    const wall = hidden[0]!.from!.face!;
    expect(hidden[1]!.from!.face).toBe(wall);
    const s = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(elements(oc, shape, "face")[wall]!), true);
    expect(s.GetType()).toBe(oc.GeomAbs_SurfaceType.GeomAbs_Cylinder);
    s.delete();
  });

  it("says where a hole's centre mark and centre line go", () => {
    const shape = drilled();
    const [end] = projectView(oc, [shape], VIEWS.top).rounds;
    expect(end).toMatchObject({ seen: "end", c: [5, 3], r: 3, hole: true });
    expect(end!.sweep).toBeCloseTo(Math.PI * 2);
    const [side] = projectView(oc, [shape], VIEWS.front).rounds;
    expect(side).toMatchObject({ seen: "side", r: 3, hole: true });
    if (side!.seen !== "side") throw new Error("not side on");
    // Its axis runs straight up the view at x = 5, the height of the block (the drill went 5 mm past each face).
    expect(side.a[0]).toBeCloseTo(5);
    expect(side.b[0]).toBeCloseTo(5);
    expect(Math.abs(side.b[1] - side.a[1])).toBeGreaterThanOrEqual(10);
    // Seen at a slant it has neither.
    expect(projectView(oc, [shape], VIEWS.iso).rounds).toEqual([]);
    // A pin is not a hole.
    expect(projectView(oc, [cylinder(oc, { x: 6, y: 6, z: 20 })], VIEWS.top).rounds[0]).toMatchObject({ hole: false, r: 3 });
  });

  it("leaves hidden edges out when asked", () => {
    const view = projectView(oc, [drilled()], VIEWS.front, { hidden: false });
    expect(view.edges).toHaveLength(4);
    expect(view.edges.every((e) => e.visible)).toBe(true);
  });

  it("joins the pieces of a rim back into one ellipse in an isometric view", () => {
    const view = projectView(oc, [drilled()], VIEWS.iso);
    const rims = of(view.edges, "ellipse");
    expect(rims.map((e) => e.visible).sort()).toEqual([false, true]);
    for (const r of rims) {
      const c = r.curve as Extract<ViewCurve, { kind: "ellipse" }>;
      expect(c.from).toBeUndefined();
      expect(c.rx).toBeCloseTo(3);
      // The top view tips back by asin(1/√3): a circle's short axis shrinks by sin of the eye's height.
      expect(c.ry).toBeCloseTo(3 / Math.sqrt(3));
    }
    // Nine of the block's twelve edges face the eye; three are behind.
    expect(of(view.edges, "line", true).filter((e) => e.type === "sharp")).toHaveLength(9);
    expect(of(view.edges, "line", false).filter((e) => e.type === "sharp")).toHaveLength(3);
  });

  it("reads a fillet's edge as an arc and its tangent edge as smooth", () => {
    // Round the four upright edges of the block, 2 mm.
    const block = box(oc, { x: 30, y: 20, z: 10 });
    const upright = elements(oc, block, "edge").flatMap((e, i) => {
      const c = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(e));
      const dz = Math.abs(c.Value(c.LastParameter()).Z() - c.Value(c.FirstParameter()).Z());
      c.delete();
      return dz > 9 ? [i] : [];
    });
    expect(upright).toHaveLength(4);
    const view = projectView(oc, [fillet(oc, block, upright, 2)], VIEWS.top);
    const arcs = of(view.edges, "arc");
    expect(arcs).toHaveLength(4);
    for (const a of arcs) expect((a.curve as { r: number }).r).toBeCloseTo(2, 2);
    expect(of(view.edges, "line")).toHaveLength(4);
    // Seen from the front the fillets are flat: where each meets a side is a tangent edge.
    const front = projectView(oc, [fillet(oc, block, upright, 2)], VIEWS.front);
    expect(front.edges.filter((e) => e.type === "smooth").length).toBeGreaterThan(0);
    expect(projectView(oc, [fillet(oc, block, upright, 2)], VIEWS.front, { smooth: false }).edges.some((e) => e.type === "smooth")).toBe(false);
  });

  it("says which body each curve came from, and hides one body behind another", () => {
    const front = place(oc, box(oc, { x: 10, y: 10, z: 10 }), { position: { x: 0, y: -20, z: 0 } });
    const behind = box(oc, { x: 30, y: 10, z: 20 });
    const view = projectView(oc, [front, behind], VIEWS.front);
    expect(view.edges.every((e) => e.from)).toBe(true);
    expect(new Set(view.edges.map((e) => e.from!.body))).toEqual(new Set([0, 1]));
    // The bottom edge of the body behind is cut where the front one covers it: two visible pieces.
    const bottom = view.edges.filter((e) => e.curve.kind === "line" && e.from!.body === 1 && e.curve.a[1] === 0 && e.curve.b[1] === 0);
    expect(bottom.filter((e) => e.visible)).toHaveLength(2);
  });

  it("draws a posed body where it stands", () => {
    const turned = place(oc, box(oc, { x: 30, y: 20, z: 10 }), { position: { x: 100, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 90 } });
    const view = projectView(oc, [turned], VIEWS.top);
    expect(view.box.min[0]).toBeCloseTo(90);
    expect(view.box.max[0]).toBeCloseTo(110);
    expect(view.box.max[1] - view.box.min[1]).toBeCloseTo(30);
  });
});

describe("curve helpers", () => {
  it("measures to an arc only along its sweep", () => {
    const arc: ViewCurve = { kind: "arc", c: [0, 0], r: 5, from: 0, to: Math.PI / 2 };
    expect(distanceTo(arc, [5 * Math.SQRT1_2, 5 * Math.SQRT1_2])).toBeCloseTo(0);
    expect(distanceTo(arc, [-5, 0])).toBeCloseTo(Math.hypot(5, 5));
    for (const p of pointsOn(arc)) expect(distanceTo(arc, p)).toBeCloseTo(0);
  });
  it("puts its sample points on an ellipse", () => {
    const e: ViewCurve = { kind: "ellipse", c: [1, 2], rx: 4, ry: 2, turn: 0.5 };
    for (const p of pointsOn(e)) expect(distanceTo(e, p)).toBeCloseTo(0);
  });
});

/**
 * Golden views (#556): each curve of a view of the bracket sample, with the name (#47) of the edge or face it came
 * from. `UPDATE_GOLDEN=1 npm run test:golden` accepts a deliberate change.
 */
describe("golden views", () => {
  const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "golden");
  const UPDATE = !!process.env.UPDATE_GOLDEN;
  const r = (n: number) => Math.round(n * 1e3) / 1e3 || 0;
  const flat = (c: ViewCurve): string => {
    const p = (v: number[]) => `${r(v[0]!)},${r(v[1]!)}`;
    switch (c.kind) {
      case "line":
        return `line ${[p(c.a), p(c.b)].sort().join(" ")}`;
      case "circle":
        return `circle ${p(c.c)} r${r(c.r)}`;
      case "arc":
        return `arc ${p(c.c)} r${r(c.r)} ${r(c.from)}..${r(c.to)}`;
      case "ellipse":
        return `ellipse ${p(c.c)} ${r(c.rx)}x${r(c.ry)} @${r(c.turn % Math.PI)}${c.from === undefined ? "" : ` ${r(c.from)}..${r(c.to!)}`}`;
      case "poly":
        return `poly ${[p(c.pts[0]!), p(c.pts.at(-1)!)].sort().join(" ")}`;
    }
  };

  const builder = () => new ModelBuilder(oc);
  const sample = (id: string) => SAMPLES.find((s) => s.id === id)!.build();
  const cases: [string, string, keyof typeof VIEWS, boolean][] = [];
  for (const model of ["bracket", "phone-stand"])
    for (const v of Object.keys(VIEWS) as (keyof typeof VIEWS)[]) cases.push([`view-${model}-${v}`, model, v, true]);
  cases.push(["view-bracket-front-visible", "bracket", "front", false], ["view-bracket-iso-visible", "bracket", "iso", false]);

  for (const [file, model, name, hidden] of cases) {
    it(`${model}, ${name}${hidden ? "" : ", visible edges only"}`, () => {
      const view = builder().view(sample(model), undefined, { shows: { all: true }, frame: VIEWS[name], hidden }, projectView);
      const lines = view.edges.map((e) => `${e.visible ? "visible" : "hidden"} ${e.type} ${flat(e.curve)} <- ${e.source?.name ?? "?"}`).sort();
      // Text, not arrays: the file then reads the same before and after Prettier.
      const got = { box: `${view.box.min.map(r).join(",")} to ${view.box.max.map(r).join(",")}`, curves: lines };
      const path = join(DIR, `${file}.json`);
      if (UPDATE || !existsSync(path)) {
        if (!UPDATE && process.env.CI) throw new Error(`No golden file for ${file}. Run UPDATE_GOLDEN=1 npm run test:golden and commit it.`);
        mkdirSync(DIR, { recursive: true });
        writeFileSync(path, JSON.stringify(got, null, 2) + "\n");
        return;
      }
      expect(got).toEqual(JSON.parse(readFileSync(path, "utf8")));
    });
  }
});

/** The view call the worker makes (#558). */
describe("a view of a model", () => {
  const bracket = () => SAMPLES.find((s) => s.id === "bracket")!.build();

  it("names each curve's body and its edge or face", () => {
    const view = new ModelBuilder(oc).view(bracket(), undefined, { shows: { all: true }, frame: VIEWS.top }, projectView);
    expect(view.bodies).toHaveLength(1);
    expect(view.edges.length).toBeGreaterThan(5);
    for (const e of view.edges) {
      expect(e.source).toMatchObject({ body: view.bodies[0], kind: e.type === "outline" ? "face" : "edge" });
      expect(e.source!.name).toBeTruthy();
    }
    // The hole in the base, seen end on: its centre, size and the face to fix a centre mark to.
    const hole = view.rounds.find((x) => x.seen === "end");
    expect(hole).toMatchObject({ seen: "end", hole: true, r: 2.25, source: { kind: "face" } });
    expect(view.ms).toBeGreaterThan(0);
  });

  it("keeps a view it has made, until a body it shows changes", () => {
    const b = new ModelBuilder(oc);
    const doc = bracket();
    const req = { shows: { all: true as const }, frame: VIEWS.right };
    const first = b.view(doc, undefined, req, projectView);
    const again = b.view(doc, undefined, req, projectView);
    expect(again.ms).toBe(0);
    expect(again.edges).toBe(first.edges);
    // Another direction, or hidden edges off, is another view.
    expect(b.view(doc, undefined, { ...req, frame: VIEWS.top }, projectView).ms).toBeGreaterThan(0);
    expect(b.view(doc, undefined, { ...req, hidden: false }, projectView).ms).toBeGreaterThan(0);
    // Renaming the model changes nothing a view shows.
    expect(b.view({ ...doc, name: "Other" }, undefined, req, projectView).ms).toBe(0);
    // A wider bracket is a new view, wider.
    const wide = { ...doc, params: doc.params!.map((p) => (p.name === "width" ? { ...p, expression: "50" } : p)) };
    const wider = b.view(wide, undefined, req, projectView);
    expect(wider.ms).toBeGreaterThan(0);
    expect(wider.box.max[0] - wider.box.min[0]).toBeGreaterThan(first.box.max[0] - first.box.min[0]);
  });

  it("keeps a curve's name when the model changes size", () => {
    const b = new ModelBuilder(oc);
    const doc = bracket();
    const req = { shows: { all: true as const }, frame: VIEWS.top };
    const names = (d: typeof doc) =>
      b
        .view(d, undefined, req, projectView)
        .edges.map((e) => `${e.type} ${e.curve.kind} ${e.source?.name}`)
        .sort();
    const wide = { ...doc, params: doc.params!.map((p) => (p.name === "width" ? { ...p, expression: "50" } : p)) };
    expect(names(wide)).toEqual(names(doc));
  });

  it("draws only the bodies asked for, and leaves hidden ones out", () => {
    const b = new ModelBuilder(oc);
    const doc = SAMPLES.find((s) => s.id === "box-with-lid")!.build();
    const all = b.view(doc, undefined, { shows: { all: true }, frame: VIEWS.front }, projectView);
    expect(all.bodies.length).toBeGreaterThan(1);
    const one = b.view(doc, undefined, { shows: { bodies: [all.bodies[0]!] }, frame: VIEWS.front }, projectView);
    expect(one.bodies).toEqual([all.bodies[0]]);
    expect(one.edges.every((e) => e.source?.body === all.bodies[0])).toBe(true);
    expect(b.view(doc, undefined, { shows: { bodies: ["nope"] }, frame: VIEWS.front }, projectView)).toMatchObject({ edges: [], bodies: [] });
  });
});
