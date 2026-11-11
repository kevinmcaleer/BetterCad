import { beforeAll, describe, expect, it } from "vitest";
import { drawArc3, drawCircle, drawLine, drawPolyline, type Sketch } from "@bettercad/sketch";
import { addPart, addSketch, addSweep, build, dependsOn, featureSummary, newDoc, updateSketch, updateSweep, type ModelDoc, type SweepParams } from "./document";
import { pathSegs } from "./extrude";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";
import { loadBcad, saveBcad } from "./bcad";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

const R = 10;
const LEN = 20 + (Math.PI / 2) * R + 20;
/** A path on the ground (a line, a quarter bend, a line) in s1; a 4 mm ring with a 2 mm bore across its start in s2. */
function tube(): ModelDoc {
  let d = addSketch(newDoc(), { kind: "world", plane: "XY", offset: 0 }, "s1");
  d = updateSketch(d, "s1", (s: Sketch) => {
    s = drawPolyline(s, [
      [30, 10],
      [30, 30],
    ]).sketch;
    s = drawArc3(s, [20, 0], [20 + R * Math.SQRT1_2, R - R * Math.SQRT1_2], [30, 10])!.sketch;
    return drawLine(s, [0, 0], [20, 0]).sketch;
  });
  d = addSketch(d, { kind: "world", plane: "YZ", offset: 0 }, "s2");
  d = updateSketch(d, "s2", (s: Sketch) => drawCircle(drawCircle(s, [0, 0], 2).sketch, [0, 0], 1).sketch);
  return d;
}
const curves = (d: ModelDoc, id: string) => {
  const f = d.features.find((x) => x.id === id);
  return f?.type === "sketch" ? f.sketch.entities.filter((e) => e.kind === "line" || e.kind === "arc").map((e) => e.id) : [];
};
const params = (d: ModelDoc, p: Partial<SweepParams> = {}): SweepParams => ({
  sketch: "s2",
  seeds: [[0, 1.5]],
  split: true,
  path: { sketch: "s1", curves: curves(d, "s1") },
  operation: "new",
  ...p,
});
const built = (d: ModelDoc) => new ModelBuilder(oc).build(d);

describe("sweep (#400)", () => {
  it("puts the path's curves end to end from a free end, whatever order they were picked in", () => {
    const d = tube();
    const f = d.features[0]!;
    if (f.type !== "sketch") throw new Error("no sketch");
    const segs = pathSegs(f.sketch, curves(d, "s1"));
    if (typeof segs === "string") throw new Error(segs);
    expect(segs.map((g) => g.kind)).toEqual(["line", "arc", "line"]);
    const ends = [segs[0]!, segs[2]!].map((g, i) => (g.kind === "circle" ? "" : (i ? g.b : g.a).join(","))).sort();
    expect(ends).toEqual(["0,0", "30,30"]);
  });

  it("pushes a ring along a bent path: a bent tube", () => {
    const d = tube();
    const s = addSweep(d, params(d), "w1", "b1");
    const r = built(s);
    expect(r.failed).toEqual([]);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(Math.PI * 3 * LEN, 2);
    expect(build(s).parts[0]).toMatchObject({ id: "b1", name: "Body 1", kind: "solid" });
    expect(featureSummary(s, s.features[2]!)).toBe("1 shape along a path of 3 curves, new body");
    expect(s.features[2]!.name).toBe("Sweep 1");
    expect(dependsOn(s, "w1")).toEqual(expect.arrayContaining(["s1", "s2"]));
  });

  it("cuts a sweep from a body", () => {
    let d = tube();
    d = addPart(d, "box", "box1");
    d = { ...d, features: d.features.map((f) => (f.type === "add" ? { ...f, part: { ...f.part, size: { x: 10, y: 10, z: 10 } } } : f)) };
    const cut = addSweep(d, params(d, { seeds: [[0, 0]], operation: "cut", target: "box1" }), "w1");
    const r = built(cut);
    expect(r.failed).toEqual([]);
    expect(r.bodies).toHaveLength(1);
    expect(r.bodies[0]!.measure.volume).toBeLessThan(1000);
  });

  it("says what it still needs", () => {
    const d = tube();
    expect(build(addSweep(d, params(d, { path: undefined }), "w1")).failed.get("w1")).toBe("Pick a path to sweep along: lines and arcs in another sketch");
    expect(build(addSweep(d, params(d, { path: { sketch: "s1", curves: [] } }), "w1")).failed.get("w1")).toBe(
      "Pick the lines and arcs of a path to sweep along",
    );
    expect(build(addSweep(d, params(d, { path: { sketch: "s2", curves: [] } }), "w1")).failed.get("w1")).toBe(
      "The path is in the shape's own sketch. Draw it in a sketch on another plane.",
    );
    const [top, , bottom] = curves(d, "s1");
    const two = addSweep(d, params(d, { path: { sketch: "s1", curves: [top!, bottom!] } }), "w1");
    expect(build(two).failed.get("w1")).toBe("The path's lines and arcs don't join end to end. Join them in the sketch.");
    expect(build(addSweep(d, params(d, { seeds: [[50, 50]] }), "w1")).failed.get("w1")).toMatch(/no longer closed/);
  });

  it("changes as one step, and saves and opens again", () => {
    let d = tube();
    d = addSweep(d, params(d), "w1");
    d = updateSweep(d, "w1", { operation: "join" });
    expect(d.features[2]).toMatchObject({ type: "sweep", operation: "join" });
    const back = loadBcad(saveBcad(d));
    expect("doc" in back && back.doc.features[2]).toMatchObject({ type: "sweep", sketch: "s2", path: { sketch: "s1" } });
  });
});
