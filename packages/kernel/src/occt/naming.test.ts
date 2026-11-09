import { beforeAll, describe, expect, it } from "vitest";
import { drawCircle, drawRectangle, type Sketch } from "@bettercad/sketch";
import { loadOCCT, type OC } from "./oc";
import { ModelBuilder, type BuiltBody } from "./model";
import { resolveNames } from "./naming";
import { addExtrude, addFinish, addSketch, newDoc, updateSketch, type ModelDoc } from "../document";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

/** A 40 × 30 × 10 mm block from a sketch, with a slot cut 4 mm deep across its top at y = 12…18. */
function slotted(): ModelDoc {
  let d = addSketch(newDoc(), { kind: "world", plane: "XY", offset: 0 }, "base");
  d = updateSketch(d, "base", (s: Sketch) => drawRectangle(s, [0, 0], [40, 30]).sketch);
  d = addExtrude(d, { sketch: "base", seeds: [[1, 1]], distance: 10, direction: "one", operation: "new" }, "block", "b1");
  d = addSketch(d, { kind: "world", plane: "XY", offset: 10 }, "top");
  d = updateSketch(d, "top", (s: Sketch) => drawRectangle(s, [-5, 12], [45, 18]).sketch);
  return addExtrude(d, { sketch: "top", seeds: [[20, 15]], distance: -4, direction: "one", operation: "cut", targets: ["b1"] }, "slot");
}

/** Moves a sketch's points, as dragging them or changing a dimension would: the curves keep their ids. */
const movePoints = (d: ModelDoc, sketch: string, fn: (x: number, y: number) => [number, number]) =>
  updateSketch(d, sketch, (s: Sketch) => ({
    ...s,
    entities: s.entities.map((e) => {
      if (e.kind !== "point") return e;
      const [x, y] = fn(e.x, e.y);
      return { ...e, x, y };
    }),
  }));

/** The block made `w` wide: the base's right side and the slot's right end move out. */
const widen = (d: ModelDoc, w: number) =>
  movePoints(
    movePoints(d, "base", (x, y) => [x > 20 ? w : x, y]),
    "top",
    (x, y) => [x > 20 ? w + 5 : x, y],
  );

const body = (m: ModelBuilder, d: ModelDoc): BuiltBody => {
  const r = m.build(d);
  expect(r.failed).toEqual([]);
  return r.bodies.find((b) => b.id === "b1")!;
};

/** The block's upright edge at x = 0, y = 0: between the faces swept from the rectangle's bottom and left lines. */
function cornerEdge(b: BuiltBody): string {
  const m = b.mesh;
  const at = b.names!.edges.find((n, i) => {
    if (!/^side\([^)]+\)\|side\([^)]+\)$/.test(n)) return false;
    const p = m.edgePositions;
    for (let k = 6 * m.edgeSegs[i]!; k < 6 * m.edgeSegs[i + 1]!; k += 3) if (Math.abs(p[k]!) > 1e-6 || Math.abs(p[k + 1]!) > 1e-6) return false;
    return true;
  });
  expect(at).toBeDefined();
  return at!;
}

describe("topological naming (#47)", () => {
  it("names an extrude's faces by the sketch lines they were swept from, and its ends", () => {
    const b = body(new ModelBuilder(oc), slotted());
    const faces = b.names!.faces;
    expect(faces.filter((n) => /^side\(/.test(n))).toHaveLength(4);
    expect(faces).toContain("cap.start");
    // The slot splits the top in two, ordered by where each half's middle is.
    expect(faces).toEqual(expect.arrayContaining(["cap.end#1", "cap.end#2"]));
    // The slot's own faces carry its step's id.
    expect(faces.filter((n) => n.startsWith("slot:")).length).toBeGreaterThanOrEqual(3);
    expect(new Set(faces).size).toBe(faces.length);
    expect(new Set(b.names!.edges).size).toBe(b.names!.edges.length);
  });

  it("keeps a fillet on the same edge when the first sketch's width changes", () => {
    const m = new ModelBuilder(oc);
    const base = slotted();
    const edge = cornerEdge(body(m, base));
    const r = 3;
    const filleted = (w: number) => addFinish(widen(base, w), { type: "fillet", part: "b1", refs: [0], names: [edge], size: r }, "f1");
    const a = m.build(filleted(40));
    const b = m.build(filleted(60));
    expect(a.failed).toEqual([]);
    expect(b.failed).toEqual([]);
    expect(b.recovered).toEqual([]);
    // A 10 mm tall corner rounded at 3 mm loses r²(1 − π/4)·10 either way; the block grows by 20 × 30 × 10 less the slot's 20 × 6 × 4.
    const loss = r * r * (1 - Math.PI / 4) * 10;
    expect(a.bodies[0]!.measure.volume).toBeCloseTo(40 * 30 * 10 - 40 * 6 * 4 - loss, 1);
    expect(b.bodies[0]!.measure.volume).toBeCloseTo(60 * 30 * 10 - 60 * 6 * 4 - loss, 1);
    // The round is named from the edge it was made from, and sits at the origin corner.
    const fb = b.bodies[0]!;
    expect(fb.names!.faces).toContain(`fillet(${edge})`);
    expect(fb.measure.bbox.min[0]).toBeCloseTo(0, 6);
  });

  it("finds an edge again when a step added before it renumbers every edge", () => {
    const m = new ModelBuilder(oc);
    const base = slotted();
    const plain = body(m, base);
    // A hole through the block, added before the fillet: the edge numbers move, the names don't.
    const withHole = (d: ModelDoc) => {
      let x = addSketch(d, { kind: "world", plane: "XY", offset: 10 }, "h");
      x = updateSketch(x, "h", (s: Sketch) => drawCircle(s, [30, 24], 2).sketch);
      return addExtrude(x, { sketch: "h", seeds: [[30, 24]], distance: -10, direction: "one", operation: "cut", targets: ["b1"] }, "hole");
    };
    const holed = body(m, withHole(base));
    // An edge of the block itself whose number the hole moved.
    const edge = plain.names!.edges.find((n, j) => !n.includes("slot") && holed.names!.edges.includes(n) && holed.names!.edges.indexOf(n) !== j)!;
    expect(edge).toBeDefined();
    const i = plain.names!.edges.indexOf(edge);
    // By number alone the fillet lands on another edge.
    const byNumber = m.build(addFinish(withHole(base), { type: "fillet", part: "b1", refs: [i], size: 1 }, "f1"));
    expect(byNumber.bodies[0]!.names!.faces).not.toContain(`fillet(${edge})`);
    const byName = m.build(addFinish(withHole(base), { type: "fillet", part: "b1", refs: [i], names: [edge], size: 1 }, "f1"));
    expect(byName.failed).toEqual([]);
    expect(byName.recovered).toEqual([]);
    expect(byName.bodies[0]!.names!.faces).toContain(`fillet(${edge})`);
  });

  it("keeps a pick on one half of a split face when the cut that splits it moves", () => {
    const m = new ModelBuilder(oc);
    const base = slotted();
    const b = body(m, base);
    // The half of the top nearer y = 0 is the first by place.
    const half = "cap.end#1";
    const shelled = (slot: [number, number]) =>
      addFinish(
        movePoints(base, "top", (x, y) => [x, y < 15 ? slot[0] : slot[1]]),
        { type: "pushpull", part: "b1", refs: [b.names!.faces.indexOf(half)], names: [half], size: 2 },
        "pp",
      );
    for (const slot of [
      [12, 18],
      [10, 17],
    ] as [number, number][]) {
      const r = m.build(shelled(slot));
      expect(r.failed).toEqual([]);
      // The front half (y from 0 to the slot) rises 2 mm; the back half doesn't.
      const grew = 40 * slot[0] * 2;
      expect(r.bodies[0]!.measure.volume).toBeCloseTo(40 * 30 * 10 - 40 * (slot[1] - slot[0]) * 4 + grew, 1);
    }
  });

  it("falls back by base name, then by number, and says so", () => {
    expect(resolveNames(["a", "b"], ["b", "a"])).toEqual({ refs: [1, 0], recovered: false });
    // `top#2` gone: the top is whole again, so it's `top`.
    expect(resolveNames(["top#2"], ["x", "top"])).toEqual({ refs: [1], recovered: true });
    // Split three ways now: the 2nd.
    expect(resolveNames(["top#2"], ["top#1", "top#3", "top#2x"])).toEqual({ refs: [1], recovered: true });
    expect(resolveNames(["gone"], ["x", "y"], [1])).toEqual({ refs: [1], recovered: true });
    expect(resolveNames(["gone"], ["x"], [5])).toEqual({ refs: [], recovered: true });
  });
});
