import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";
import { elements } from "./occt/shapes";
import { signature } from "./occt/repick";
import { addCombine, addFinish, addPart, addPattern, build, changeParts, mirrorableFeatures, newDoc, updatePattern, type ModelDoc } from "./document";

/** Pattern and Mirror copies of fillets and chamfers (#426): each copy finds its own edge where the original's was. */
let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

/** A 40 mm plate with a 6 mm peg joined on at x = 12 ("j") and its top rim chamfered 1 mm ("f"). */
function peg(): ModelDoc {
  let doc: ModelDoc = changeParts(addPart(newDoc(), "box", "b"), ["b"], "size", { x: 40, y: 40, z: 5 });
  doc = changeParts(addPart(doc, "cylinder", "peg"), ["peg"], "size", { x: 6, y: 6, z: 8 });
  doc = changeParts(doc, ["peg"], "position", { x: 12, y: 0, z: 5 });
  doc = addCombine(doc, { mode: "combine", target: "b", tools: [{ id: "peg", op: "join" }] }, "j");
  const before = new ModelBuilder(oc).solid(build(doc).parts.find((q) => q.id === "b")!).shape;
  const top = elements(oc, before, "edge").findIndex((e) => {
    const s = signature(oc, e, "edge");
    return !s.dir && Math.hypot(s.at[0] - 12, s.at[1], s.at[2] - 13) < 0.01;
  });
  return addFinish(doc, { type: "chamfer", part: "b", refs: [top], size: 1 }, "f");
}

const plate = (b: ModelBuilder, doc: ModelDoc) => {
  const r = b.build(doc);
  return { r, m: r.bodies.find((x) => x.id === "b")!.measure };
};

describe("patterned fillets and chamfers", () => {
  it("offers fillets and chamfers to a Pattern of features", () => {
    expect(mirrorableFeatures(peg()).map((f) => f.id)).toEqual(expect.arrayContaining(["j", "f"]));
  });

  it("chamfers every copy, and again after the pattern changes, even with the original's picks forgotten", () => {
    const b = new ModelBuilder(oc);
    let doc = addPattern(peg(), { parts: [], kind: "circle", of: "features", features: ["j", "f"], count: 4, angle: 360 }, "p");
    const four = plate(b, doc);
    expect(four.r.failed).toEqual([]);
    expect(four.m.faces).toBe(6 + 4 * 3);
    doc = updatePattern(doc, "p", { count: 3 });
    const three = plate(b, doc);
    expect(three.r.failed).toEqual([]);
    expect(three.m.faces).toBe(6 + 3 * 3);
    // A builder that kept the steps but lost where the picks were makes the original again to find them.
    (b as unknown as { picksAt: Map<string, unknown> }).picksAt.clear();
    const again = plate(b, updatePattern(doc, "p", { count: 2 }));
    expect(again.r.failed).toEqual([]);
    expect(again.m.faces).toBe(6 + 2 * 3);
  }, 60_000);

  it("leaves out a copy with no edge where the original's was, with a warning rather than a failure", () => {
    // Only the chamfer is copied, so the turned copies have no peg to chamfer.
    const doc = addPattern(peg(), { parts: [], kind: "circle", of: "features", features: ["f"], count: 4, angle: 360 }, "p");
    const { r, m } = plate(new ModelBuilder(oc), doc);
    expect(r.failed).toEqual([]);
    expect(r.recovered.map(([id]) => id)).toContain("p");
    expect(m.faces).toBe(6 + 3);
  }, 60_000);
});
