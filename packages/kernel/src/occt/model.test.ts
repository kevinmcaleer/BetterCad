import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./oc";
import { ModelBuilder, canonical, chain, partKey } from "./model";
import { drawCircle, drawRectangle, type Sketch } from "@bettercad/sketch";
import { addExtrude, addFinish, addPart, addSketch, changeParts, newDoc, updateExtrude, updateSketch, type ModelDoc, type Part } from "../document";

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

describe("incremental rebuild (#76)", () => {
  /** Twenty steps: the holey block's sketch and extrude, then nine sketches each cutting a hole. */
  const twenty = () => holey(9);
  const rebuilt = (r: ReturnType<ModelBuilder["build"]>) => r.timings.filter((t) => !t.cached).map((t) => t.feature);

  it("keys settings the same whatever order they're written in, and ignores float noise", () => {
    const a = { kind: "box", size: { x: 10, y: 20, z: 30 }, position: { x: 0.1 + 0.2, y: 0, z: 0 } };
    const b = { position: { z: 0, y: -0, x: 0.3 }, size: { z: 30, x: 10, y: 20 }, kind: "box" };
    expect(canonical(a)).toBe(canonical(b));
    expect(partKey(a as Part, "fast")).toBe(partKey(b as Part, "fast"));
    expect(canonical({ x: 1, y: undefined })).toBe(canonical({ x: 1 }));
    expect(canonical({ x: 1 })).not.toBe(canonical({ x: 1.000001 }));
    expect(chain("k", { op: "cut", feature: "a", size: 2 })).toBe(chain("k", { size: 2, feature: "a", op: "cut" }));
  });

  it("rebuilds only the step that changed, or everything when the first one does", () => {
    const m = new ModelBuilder(oc);
    const doc = twenty();
    expect(doc.features).toHaveLength(20);
    expect(rebuilt(m.build(doc))).toHaveLength(10);
    // The last cut: only it.
    expect(rebuilt(m.build(updateExtrude(doc, "c8", { distance: -9 })))).toEqual(["c8"]);
    // The block's sketch: the block and every cut after it.
    const wider = updateSketch(doc, "base", (s: Sketch) => ({
      ...s,
      entities: s.entities.map((e) => (e.kind === "point" && e.x > 50 ? { ...e, x: 110 } : e)),
    }));
    expect(rebuilt(m.build(wider))).toHaveLength(10);
  });

  it("rebuilds only the bodies a changed sketch makes", () => {
    const m = new ModelBuilder(oc);
    let doc = many(16);
    doc = addSketch(doc, { kind: "world", plane: "XY", offset: 0 }, "shared");
    doc = updateSketch(doc, "shared", (s: Sketch) => drawCircle(drawCircle(s, [100, 0], 5).sketch, [130, 0], 5).sketch);
    doc = addExtrude(doc, { sketch: "shared", seeds: [[100, 0]], distance: 5, direction: "one", operation: "new" }, "e1", "x1");
    doc = addExtrude(doc, { sketch: "shared", seeds: [[130, 0]], distance: 5, direction: "one", operation: "new" }, "e2", "x2");
    expect(doc.features).toHaveLength(19);
    m.build(doc);
    const moved = updateSketch(doc, "shared", (s: Sketch) => ({
      ...s,
      entities: s.entities.map((e) => (e.kind === "circle" ? { ...e, r: 6 } : e)),
    }));
    expect(rebuilt(m.build(moved)).sort()).toEqual(["e1", "e2"]);
  });

  it("undoes and redoes from the cache", () => {
    const m = new ModelBuilder(oc);
    const doc = twenty();
    m.build(doc);
    const edited = updateExtrude(doc, "c4", { distance: -8 });
    m.build(edited);
    const undo = m.build(doc);
    expect(undo.made).toBe(0);
    expect(rebuilt(undo)).toEqual([]);
    expect(rebuilt(m.build(edited))).toEqual([]);
    // Scrubbing the marker back reuses the steps built on the way.
    expect(rebuilt(m.build(doc, 12))).toEqual([]);
  });

  it("drops the least recently used bodies first, never those just built", () => {
    const m = new ModelBuilder(oc, { bodies: 2, bytes: Infinity });
    const one = (kind: "box" | "cylinder" | "sphere") => addPart(newDoc(), kind, kind);
    m.build(one("box"));
    m.build(one("cylinder"));
    m.build(one("sphere"));
    expect(m.cachedKeys().map((k) => JSON.parse(k)[0])).toEqual(["cylinder", "sphere"]);
    // Using the cylinder again makes it the newest, so the sphere goes next.
    m.build(one("cylinder"));
    m.build(one("box"));
    expect(m.cachedKeys().map((k) => JSON.parse(k)[0])).toEqual(["cylinder", "box"]);
    // Over the memory bound, only what the build used is kept.
    const tight = new ModelBuilder(oc, { bodies: 100, bytes: 1 });
    tight.build(one("box"));
    const r = tight.build(many(2));
    expect(tight.cachedKeys()).toHaveLength(2);
    expect(r.cache.bodies).toBe(2);
    expect(r.cache.bytes).toBeGreaterThan(1);
  });

  it("says how far a build has got", () => {
    const seen: [number, number][] = [];
    new ModelBuilder(oc).build(many(3), undefined, "fast", undefined, (done, total) => seen.push([done, total]));
    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });
});

describe("editing a step from the timeline (#73)", () => {
  it("changes an extrude's distance and rebuilds what follows", () => {
    const m = new ModelBuilder(oc);
    const doc = holey(2);
    expect(m.build(doc).bodies[0]!.measure.volume).toBeCloseTo(100 * 80 * 20 - Math.PI * 16 * 10, 2);
    // The block 30 mm tall: its holes are cut into the old top, 10 mm below the new one, so they're inside it now.
    const taller = m.build(updateExtrude(doc, "block", { distance: 30 }));
    expect(taller.failed).toEqual([]);
    expect(taller.bodies[0]!.measure.volume).toBeCloseTo(100 * 80 * 30 - Math.PI * 16 * 10, 2);
  });
});
