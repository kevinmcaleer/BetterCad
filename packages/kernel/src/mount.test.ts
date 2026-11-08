import { beforeAll, describe, expect, it } from "vitest";
import { circlePattern, rectPattern } from "./catalogue";
import { HOLE_PATTERNS } from "./catalogue/list";
import { MOUNT_DEFAULTS, addMount, addPart, build, changeParts, hornPoints, newDoc, updateMount, type ModelDoc, type MountParams } from "./document";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

const TOP = { origin: [0, 0, 5] as [number, number, number], x: [1, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };

function plate(params: Partial<MountParams>): ModelDoc {
  const d = changeParts(addPart(newDoc(), "box", "plate"), ["plate"], "size", { x: 100, y: 80, z: 5 });
  return addMount(d, { ...MOUNT_DEFAULTS, kind: "standoffs", part: "plate", frame: TOP, points: [[0, 0]], ...params }, "m1");
}

const built = (doc: ModelDoc) => {
  const r = new ModelBuilder(oc).build(doc);
  expect(r.failed).toEqual([]);
  return r.bodies.find((b) => b.id === "plate")!.measure;
};

describe("hole patterns (#189)", () => {
  it("has the boards' patterns, centred", () => {
    const pi = HOLE_PATTERNS.find((p) => p.id === "pi-4")!;
    expect(pi).toMatchObject({ label: "Raspberry Pi 4 Model B (58 × 49 mm)", screw: "M2.5" });
    expect(pi.points).toEqual(rectPattern(58, 49));
    expect(HOLE_PATTERNS.find((p) => p.id === "pico")!.label).toBe("Raspberry Pi Pico (47 × 11.4 mm)");
    expect(HOLE_PATTERNS.find((p) => p.id === "sg90")!.label).toBe("SG90 micro servo (27.8 mm)");
  });

  it("makes rectangles and circles of holes", () => {
    expect(rectPattern(10, 4)).toEqual([
      [-5, -2],
      [5, -2],
      [5, 2],
      [-5, 2],
    ]);
    const c = circlePattern(4, 20);
    expect(c).toEqual([
      [10, 0],
      [0, 10],
      [-10, 0],
      [0, -10],
    ]);
  });

  it("puts horn holes along the arms", () => {
    expect(hornPoints("single", 10)).toEqual([[10, 0]]);
    expect(hornPoints("double", 10)).toEqual([
      [10, 0],
      [-10, 0],
    ]);
    expect(hornPoints("cross", 10)).toHaveLength(4);
  });
});

describe("standoffs (#189)", () => {
  it("stands M2.5 standoffs on a Pi's pattern with clearance holes right through", () => {
    const doc = plate({ points: rectPattern(58, 49), size: "M2.5", height: 6, outer: 6 });
    const m = built(doc);
    const bore = Math.PI * 1.45 ** 2; // M2.5 printed: 2.9 mm
    expect(m.volume).toBeCloseTo(100 * 80 * 5 + 4 * (Math.PI * 9 * 6) - 4 * bore * 11, 0);
    expect(m.bbox.max[2]).toBeCloseTo(11, 6);
  });

  it("can take heat-set inserts instead", () => {
    const doc = plate({ points: rectPattern(58, 49), size: "M2.5", height: 6, outer: 6, hole: "insert" });
    const m = built(doc);
    const insert = Math.PI * 1.75 ** 2 * 5; // M2.5 insert: 3.5 mm, 4 mm long, plus 1 mm
    expect(m.volume).toBeCloseTo(100 * 80 * 5 + 4 * (Math.PI * 9 * 6) - 4 * insert, 0);
  });

  it("says what's wrong, and edits live", () => {
    let doc = plate({ outer: 3 });
    expect(build(doc).failed.get("m1")).toMatch(/wider than/);
    doc = updateMount(doc, "m1", { outer: 6, height: 0 });
    expect(build(doc).failed.get("m1")).toMatch(/height/);
    doc = updateMount(doc, "m1", { height: 6, size: "M6", hole: "insert" });
    expect(build(doc).failed.get("m1")).toMatch(/no heat-set insert/);
  });
});

describe("servo horn mount (#189)", () => {
  it("recesses the hub and drills the arm holes and the screwdriver hole", () => {
    const doc = plate({ kind: "horn", horn: "cross", size: "M2", hub: 7.5, recess: 2, arm: 10, access: 3 });
    expect(doc.features.at(-1)!.name).toBe("Horn mount 1");
    const m = built(doc);
    const hub = Math.PI * 3.75 ** 2 * 2;
    const access = Math.PI * 1.5 ** 2 * 3; // the rest of the plate under the recess
    const arms = 4 * Math.PI * 1.2 ** 2 * 5;
    expect(m.volume).toBeCloseTo(100 * 80 * 5 - hub - access - arms, 0);
  });
});
