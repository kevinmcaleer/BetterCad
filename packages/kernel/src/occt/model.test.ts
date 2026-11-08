import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./oc";
import { ModelBuilder } from "./model";
import { drawCircle, drawRectangle, type Sketch } from "@bettercad/sketch";
import { addExtrude, addFinish, addPart, addSketch, changeParts, newDoc, updateExtrude, updateSketch, type ModelDoc } from "../document";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

function many(n: number): ModelDoc {
  let doc = newDoc();
  const kinds = ["box", "cylinder", "sphere"] as const;
  for (let i = 0; i < n; i++) doc = addPart(doc, kinds[i % 3]!, `p${i}`);
  return doc;
}

/** A 100 × 80 × 20 mm block with `n` 4 mm holes cut into its top, the last one 5 mm deep. */
function holey(n: number): ModelDoc {
  let d = addSketch(newDoc(), { kind: "world", plane: "XY", offset: 0 }, "base");
  d = updateSketch(d, "base", (s: Sketch) => drawRectangle(s, [0, 0], [100, 80]).sketch);
  d = addExtrude(d, { sketch: "base", seeds: [[1, 1]], distance: 20, direction: "one", operation: "new" }, "block", "b1");
  for (let i = 0; i < n; i++) {
    const at: [number, number] = [10 + (i % 6) * 15, 10 + Math.floor(i / 6) * 15];
    d = addSketch(d, { kind: "world", plane: "XY", offset: 20 }, `s${i}`);
    d = updateSketch(d, `s${i}`, (s: Sketch) => drawCircle(s, at, 4).sketch);
    d = addExtrude(d, { sketch: `s${i}`, seeds: [at], distance: -5, direction: "one", operation: "cut", targets: ["b1"] }, `c${i}`);
  }
  return d;
}

describe("ModelBuilder", () => {
  it("redoes only the changed step and those after it, as when a cut's arrow is dragged", () => {
    const m = new ModelBuilder(oc);
    const doc = holey(8);
    expect(m.build(doc).made).toBe(8);
    // The last cut: only it is made again.
    const deeper = updateExtrude(doc, "c7", { distance: -9 });
    const r = m.build(deeper);
    expect(r.made).toBe(1);
    // A cut part way along: it and the ones after it.
    expect(m.build(updateExtrude(deeper, "c5", { distance: -7 })).made).toBe(3);
    // Same body as building from scratch.
    const fresh = new ModelBuilder(oc).build(deeper);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(fresh.bodies[0]!.measure.volume, 6);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(100 * 80 * 20 - Math.PI * 16 * (7 * 5 + 9), 3);
  });

  it("still reports a step that failed when the body is reused from part way", () => {
    const m = new ModelBuilder(oc);
    // A fillet far too big for its edge fails; a later cut is then dragged.
    let doc = addFinish(holey(3), { type: "fillet", part: "b1", refs: [0], size: 200 }, "miss");
    doc = addSketch(doc, { kind: "world", plane: "XY", offset: 20 }, "last");
    doc = updateSketch(doc, "last", (s: Sketch) => drawCircle(s, [60, 60], 4).sketch);
    doc = addExtrude(doc, { sketch: "last", seeds: [[60, 60]], distance: -5, direction: "one", operation: "cut", targets: ["b1"] }, "end");
    const first = m.build(doc).failed;
    expect(first.map(([id]) => id)).toContain("miss");
    const again = m.build(updateExtrude(doc, "end", { distance: -6 }));
    expect(again.made).toBe(1);
    expect(again.failed).toEqual(first);
  });

  it("builds every part into a mesh and exact measures", () => {
    const doc = many(3);
    const r = new ModelBuilder(oc).build(doc);
    expect(r.bodies.map((b) => b.id)).toEqual(["p0", "p1", "p2"]);
    expect(r.failed).toEqual([]);
    for (const b of r.bodies) {
      expect(b.measure.volume).toBeGreaterThan(0);
      expect(b.mesh.indices.length).toBeGreaterThan(0);
    }
  });

  it("builds up to the timeline marker", () => {
    const r = new ModelBuilder(oc).build(many(3), 1);
    expect(r.bodies.map((b) => b.id)).toEqual(["p0"]);
  });

  it("reuses what it built before (#50: a 60-part model rebuilds in well under a second)", () => {
    const m = new ModelBuilder(oc);
    const doc = many(60);
    const first = m.build(doc);
    const moved = changeParts(doc, ["p5"], "position", { x: 40 });
    const again = m.build(moved);
    expect(again.bodies).toHaveLength(60);
    expect(again.bodies[0]!.mesh).toBe(first.bodies[0]!.mesh);
    expect(again.bodies[5]!.mesh).not.toBe(first.bodies[5]!.mesh);
    expect(again.ms).toBeLessThan(1000);
  });

  it("stops when cancelled", () => {
    expect(() => new ModelBuilder(oc).build(many(2), undefined, "fast", () => true)).toThrow(/Stopped/);
  });
});
