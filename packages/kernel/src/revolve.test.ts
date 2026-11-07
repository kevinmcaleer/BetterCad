import { beforeAll, describe, expect, it } from "vitest";
import { drawLine, drawRectangle, type Sketch } from "@bettercad/sketch";
import {
  addExtrude,
  addFinish,
  addPart,
  addRevolve,
  addSketch,
  build,
  featureSummary,
  newDoc,
  updateSketch,
  type ModelDoc,
  type RevolveParams,
} from "./document";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";
import { elements } from "./occt/shapes";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

/** On the XZ plane: a 10 × 30 mm rectangle from x = 5 to 15, beside the Z axis (the sketch's Y axis). */
function sketched(fn: (s: Sketch) => Sketch = (s) => drawRectangle(s, [5, 0], [15, 30]).sketch): ModelDoc {
  const d = addSketch(newDoc(), { kind: "world", plane: "XZ", offset: 0 }, "s1");
  return updateSketch(d, "s1", fn);
}
const params = (p: Partial<RevolveParams> = {}): RevolveParams => ({
  sketch: "s1",
  seeds: [[10, 15]],
  axis: { kind: "y" },
  angle: 360,
  operation: "new",
  ...p,
});
const volume = (d: ModelDoc) => {
  const r = new ModelBuilder(oc).build(d);
  expect(r.failed).toEqual([]);
  return r.bodies.map((b) => b.measure.volume);
};

describe("revolve", () => {
  it("turns a rectangle beside the axis into a tube", () => {
    const d = addRevolve(sketched(), params(), "r1", "b1");
    expect(build(d).parts[0]).toMatchObject({ kind: "solid", size: { x: 30, y: 30, z: 30 } });
    expect(featureSummary(d, d.features[1]!)).toBe("Full turn round the sketch's Y axis, new body");
    expect(volume(d)[0]).toBeCloseTo(Math.PI * (15 ** 2 - 5 ** 2) * 30, 0);
  });

  it("turns a quarter, both ways when symmetric", () => {
    const quarter = (Math.PI * (15 ** 2 - 5 ** 2) * 30) / 4;
    expect(volume(addRevolve(sketched(), params({ angle: 90 }), "r1"))[0]).toBeCloseTo(quarter, 0);
    expect(volume(addRevolve(sketched(), params({ angle: 90, symmetric: true }), "r1"))[0]).toBeCloseTo(quarter, 0);
  });

  it("turns round a sketch line", () => {
    let lineId = "";
    const d0 = sketched((s) => {
      const r = drawRectangle(s, [5, 0], [15, 30]).sketch;
      const l = drawLine(r, [0, 0], [0, 10]);
      lineId = l.ids.find((id) => l.sketch.entities.find((e) => e.id === id)?.kind === "line")!;
      return l.sketch;
    });
    expect(volume(addRevolve(d0, params({ axis: { kind: "line", id: lineId } }), "r1"))[0]).toBeCloseTo(Math.PI * (15 ** 2 - 5 ** 2) * 30, 0);
  });

  it("refuses a shape across the axis", () => {
    const d = addRevolve(
      sketched((s) => drawRectangle(s, [-5, 0], [15, 30]).sketch),
      params(),
      "r1",
    );
    expect(build(d).failed.get("r1")).toBe("The shape crosses the axis, so it can't be revolved. Move it to one side.");
  });

  it("cuts a groove into a cylinder", () => {
    let d = addPart(
      sketched((s) => drawRectangle(s, [8, 10], [12, 14]).sketch),
      "cylinder",
      "c",
    );
    d = addRevolve(d, params({ seeds: [[10, 12]], operation: "cut", target: "c" }), "r1");
    // A 20 × 30 mm cylinder (r 10) less a 4 × 4 mm ring from r 8 to 10.
    expect(volume(d)[0]).toBeCloseTo(Math.PI * 100 * 30 - Math.PI * (10 ** 2 - 8 ** 2) * 4, 0);
  });
});

describe("push/pull", () => {
  const box = () => addPart(newDoc(), "box", "b");
  // Face 5 is the box's top (see the shell test).
  it("pulls the top of a 20 mm box up 5 mm", () => {
    const d = addFinish(box(), { type: "pushpull", part: "b", refs: [5], size: 5 }, "p1");
    expect(featureSummary(d, d.features[1]!)).toBe("Out 5 mm, Box 1");
    const r = new ModelBuilder(oc).build(d);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(20 * 20 * 25, 1);
    expect(r.bodies[0]!.measure.bbox.max[2]).toBeCloseTo(25, 3);
    expect(r.bodies[0]!.measure.faces).toBe(6);
  });

  it("pushes it in 5 mm", () => {
    expect(volume(addFinish(box(), { type: "pushpull", part: "b", refs: [5], size: -5 }, "p1"))[0]).toBeCloseTo(20 * 20 * 15, 1);
  });

  it("fills a pocket flush", () => {
    let d = addSketch(addPart(newDoc(), "box", "b"), { kind: "world", plane: "XY", offset: 20 }, "s1");
    d = updateSketch(d, "s1", (s) => drawRectangle(s, [-5, -5], [5, 5]).sketch);
    d = addExtrude(d, { sketch: "s1", seeds: [[0, 0]], distance: -5, direction: "one", operation: "cut", target: "b" }, "e1");
    const m = new ModelBuilder(oc);
    const pocket = m.build(d);
    expect(pocket.bodies[0]!.measure.volume).toBeCloseTo(8000 - 500, 1);
    // The pocket's floor: the face facing up at z = 15.
    const floor = findFace(m, d, [0, 0, 15]);
    expect(volume(addFinish(d, { type: "pushpull", part: "b", refs: [floor], size: 5 }, "p1"))[0]).toBeCloseTo(8000, 1);
  });
});

/** The index of the flat face through a point, found by pulling each face and seeing which one grows the right way. */
function findFace(m: ModelBuilder, d: ModelDoc, at: [number, number, number]): number {
  const part = build(d).parts[0]!;
  const { shape } = m.solid(part);
  // Each face's centre of mass, from OCCT.
  const faces = elements(oc, shape, "face");
  for (let i = 0; i < faces.length; i++) {
    const props = new oc.GProp_GProps();
    oc.BRepGProp.SurfaceProperties(faces[i]!, props, false, false);
    const c = props.CentreOfMass();
    if (Math.hypot(c.X() - at[0], c.Y() - at[1], c.Z() - at[2]) < 1e-6) return i;
  }
  throw new Error("no face there");
}
