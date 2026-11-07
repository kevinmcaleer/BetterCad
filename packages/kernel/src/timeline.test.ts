import { beforeAll, describe, expect, it } from "vitest";
import { drawRectangle, type Sketch } from "@bettercad/sketch";
import { addExtrude, addFinish, addPart, addSketch, build, newDoc, updateFinish, updateSketch, type ModelDoc } from "./document";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

/** A 10 mm square at the origin on the XY plane, `up` mm above it. */
const square = (d: ModelDoc, id: string, up: number, w = 10) => {
  const s = addSketch(d, { kind: "world", plane: "XY", offset: up }, id);
  return updateSketch(s, id, (k: Sketch) => drawRectangle(k, [0, 0], [w, 10]).sketch);
};

/** Twenty steps: a block extruded from Sketch 1, then nine more sketches each joined on top, 10 mm at a time. */
function tower(): ModelDoc {
  let d = square(newDoc(), "s0", 0);
  d = addExtrude(d, { sketch: "s0", seeds: [[5, 5]], distance: 10, direction: "one", operation: "new" }, "x0", "body");
  for (let k = 1; k < 10; k++) {
    d = square(d, `s${k}`, 10 * k);
    d = addExtrude(d, { sketch: `s${k}`, seeds: [[5, 5]], distance: 10, direction: "one", operation: "join", target: "body" }, `x${k}`);
  }
  return d;
}

describe("timeline rebuilds (#78)", () => {
  it("edits the first sketch of a 20-step model and rebuilds to the right volume", () => {
    const m = new ModelBuilder(oc);
    const d = tower();
    expect(d.features).toHaveLength(20);
    expect(m.build(d).bodies[0]!.measure.volume).toBeCloseTo(10 * 10 * 100, 3);
    // The first square becomes 20 × 10: only the bottom block grows.
    const wider = updateSketch(d, "s0", (k) => drawRectangle({ ...k, entities: [], constraints: [], dimensions: [] }, [0, 0], [20, 10]).sketch);
    const t0 = performance.now();
    const r = m.build(wider);
    const ms = performance.now() - t0;
    expect(r.failed).toEqual([]);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(10 * 10 * 100 + 10 * 10 * 10, 3);
    expect(ms).toBeLessThan(5000);
  });

  it("marks a fillet whose edge is gone, then builds once it is re-picked", () => {
    const d = addFinish(addPart(newDoc(), "box", "b"), { type: "fillet", part: "b", refs: [99], size: 2 }, "f1");
    const r = new ModelBuilder(oc).build(d);
    expect(r.failed.map(([id]) => id)).toEqual(["f1"]);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(8000, 3);
    const fixed = updateFinish(d, "f1", { refs: [0] });
    const ok = new ModelBuilder(oc).build(fixed);
    expect(ok.failed).toEqual([]);
    expect(ok.bodies[0]!.measure.volume).toBeLessThan(8000);
    expect(build(fixed).failed.size).toBe(0);
  });
});
