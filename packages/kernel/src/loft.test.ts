import { beforeAll, describe, expect, it } from "vitest";
import { drawCentreRectangle, drawCircle, type Sketch } from "@bettercad/sketch";
import { addLoft, addPart, addSketch, build, dependsOn, featureSummary, newDoc, updateLoft, updateSketch, type LoftParams, type ModelDoc } from "./document";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";
import { loadBcad, saveBcad } from "./bcad";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

/** Sketches on the XY plane at each height, each drawn by `draw`: s1, s2... */
function sketches(...layers: [number, (s: Sketch) => Sketch][]): ModelDoc {
  let d = newDoc();
  layers.forEach(([z, draw], i) => {
    d = addSketch(d, { kind: "world", plane: "XY", offset: z }, `s${i + 1}`);
    d = updateSketch(d, `s${i + 1}`, draw);
  });
  return d;
}
const square = (w: number) => (s: Sketch) => drawCentreRectangle(s, [0, 0], [w / 2, w / 2]).sketch;
const circle = (r: number) => (s: Sketch) => drawCircle(s, [0, 0], r).sketch;
const params = (p: Partial<LoftParams> = {}): LoftParams => ({
  sections: [
    { sketch: "s1", seed: [0, 0] },
    { sketch: "s2", seed: [0, 0] },
  ],
  ruled: true,
  operation: "new",
  ...p,
});
const built = (d: ModelDoc) => new ModelBuilder(oc).build(d);

describe("loft (#399)", () => {
  it("runs a 20 mm square into a 10 mm one 10 mm up: a frustum", () => {
    const d = addLoft(sketches([0, square(20)], [10, square(10)]), params(), "l1", "b1");
    const r = built(d);
    expect(r.failed).toEqual([]);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo((10 / 3) * (400 + 100 + 200), 3);
    expect(build(d).parts[0]).toMatchObject({ id: "b1", name: "Body 1", kind: "solid", size: { x: 20, y: 20, z: 10 } });
    expect(featureSummary(d, d.features[2]!)).toBe("Through 2 shapes, straight sides, new body");
    expect(d.features[2]!.name).toBe("Loft 1");
  });

  it("runs a square into a circle smoothly", () => {
    const d = addLoft(sketches([0, square(20)], [20, circle(6)]), params({ ruled: false }), "l1");
    const r = built(d);
    expect(r.failed).toEqual([]);
    const v = r.bodies[0]!.measure.volume;
    // Between the circle's prism and the square's.
    expect(v).toBeGreaterThan(Math.PI * 36 * 20);
    expect(v).toBeLessThan(400 * 20);
    expect(featureSummary(d, d.features[2]!)).toBe("Through 2 shapes, new body");
  });

  it("cuts a loft from a body, and joins one to it", () => {
    let d = sketches([5, square(10)], [20, square(20)]);
    d = addPart(d, "box", "box1");
    d = { ...d, features: d.features.map((f) => (f.type === "add" ? { ...f, part: { ...f.part, size: { x: 30, y: 30, z: 20 } } } : f)) };
    const cut = addLoft(d, params({ operation: "cut", target: "box1" }), "l1");
    const r = built(cut);
    expect(r.failed).toEqual([]);
    expect(r.bodies).toHaveLength(1);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(30 * 30 * 20 - (15 / 3) * (100 + 400 + 200), 2);
    expect(featureSummary(cut, cut.features.at(-1)!)).toMatch(/^Through 2 shapes, straight sides, cut /);
    expect(dependsOn(cut, "l1")).toEqual(expect.arrayContaining(["s1", "s2"]));
  });

  it("goes through three shapes in order", () => {
    let d = sketches([0, square(20)], [10, square(8)], [20, square(16)]);
    d = addLoft(d, params({ sections: [...params().sections, { sketch: "s3", seed: [0, 0] }] }), "l1");
    const r = built(d);
    expect(r.failed).toEqual([]);
    expect(r.bodies[0]!.measure.bbox.max[2]).toBeCloseTo(20, 5);
  });

  it("says what it still needs", () => {
    const d = sketches([0, square(20)], [10, square(10)]);
    const one = addLoft(d, params({ sections: [{ sketch: "s1", seed: [0, 0] }] }), "l1");
    expect(build(one).failed.get("l1")).toBe("Pick a shape on another plane to loft to");
    const none = addLoft(d, params({ sections: [] }), "l1");
    expect(build(none).failed.get("l1")).toBe("Pick two or more closed shapes, each on its own plane");
    const flat = addLoft(
      d,
      params({
        sections: [
          { sketch: "s1", seed: [0, 0] },
          { sketch: "s1", seed: [0, 0] },
        ],
      }),
      "l1",
    );
    expect(build(flat).failed.get("l1")).toBe("Shapes 1 and 2 are on the same plane. Pick shapes on planes apart from each other.");
    const gone = addLoft(
      d,
      params({
        sections: [
          { sketch: "s1", seed: [0, 0] },
          { sketch: "s2", seed: [50, 50] },
        ],
      }),
      "l1",
    );
    expect(build(gone).failed.get("l1")).toBe("Shape 2 is no longer closed. Close it in the sketch, or pick it again.");
  });

  it("changes as one step, and saves and opens again", () => {
    let d = addLoft(sketches([0, square(20)], [10, square(10)]), params(), "l1");
    d = updateLoft(d, "l1", { ruled: false });
    expect(d.features[2]).toMatchObject({ type: "loft", ruled: false });
    const back = loadBcad(saveBcad(d));
    expect("doc" in back && back.doc.features[2]).toMatchObject({ type: "loft", sections: params().sections });
  });
});
