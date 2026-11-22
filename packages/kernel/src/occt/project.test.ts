import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./oc";
import { boolean, box, cylinder, elements, fillet, place, type TopoDS_Shape } from "./shapes";
import { ModelBuilder } from "./model";
import { build } from "../document";
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

  for (const name of ["front", "top", "right", "iso"] as const) {
    it(`bracket, ${name}`, () => {
      const builder = new ModelBuilder(oc);
      const solids = build(SAMPLES.find((s) => s.id === "bracket")!.build()).parts.map((p) => builder.solid(p));
      const view = projectView(
        oc,
        solids.map((s) => s.shape),
        VIEWS[name],
      );
      const lines = view.edges
        .map((e) => {
          const names = solids[e.from?.body ?? 0]!.body.names;
          const source = !e.from
            ? "?"
            : e.from.edge !== undefined
              ? (names?.edges[e.from.edge] ?? `edge ${e.from.edge}`)
              : (names?.faces[e.from.face!] ?? `face ${e.from.face}`);
          return `${e.visible ? "visible" : "hidden"} ${e.type} ${flat(e.curve)} <- ${source}`;
        })
        .sort();
      // Text, not arrays: the file then reads the same before and after Prettier.
      const got = { box: `${view.box.min.map(r).join(",")} to ${view.box.max.map(r).join(",")}`, curves: lines };
      const file = join(DIR, `view-bracket-${name}.json`);
      if (UPDATE || !existsSync(file)) {
        if (!UPDATE && process.env.CI) throw new Error(`No golden file for view-bracket-${name}. Run UPDATE_GOLDEN=1 npm run test:golden and commit it.`);
        mkdirSync(DIR, { recursive: true });
        writeFileSync(file, JSON.stringify(got, null, 2) + "\n");
        return;
      }
      expect(got).toEqual(JSON.parse(readFileSync(file, "utf8")));
    });
  }
});
