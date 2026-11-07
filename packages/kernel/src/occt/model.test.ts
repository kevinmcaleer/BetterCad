import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./oc";
import { ModelBuilder } from "./model";
import { addPart, changeParts, newDoc, type ModelDoc } from "../document";

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

describe("ModelBuilder", () => {
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
