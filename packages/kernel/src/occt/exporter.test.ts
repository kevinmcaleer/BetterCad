import { beforeAll, describe, expect, it } from "vitest";
import { drawRectangle, type Sketch } from "@bettercad/sketch";
import { loadOCCT, type OC } from "./oc";
import { ModelBuilder } from "./model";
import { Exporter } from "./exporter";
import { DEFLECTION, readStep } from "./export";
import { addExtrude, addPart, addSketch, newDoc, setLook, updateSketch, type ModelDoc } from "../document";
import { meshVolume, read3mf, readStl } from "../export/mesh";
import { measure } from "./shapes";

let oc: OC;
let m: ModelBuilder;
let x: Exporter;
beforeAll(async () => {
  oc = await loadOCCT();
  m = new ModelBuilder(oc);
  x = new Exporter(oc, m);
}, 60_000);

/** The timeline test model (#78): ten 10 mm blocks joined into one 10 × 10 × 100 tower. */
function tower(): ModelDoc {
  const square = (d: ModelDoc, id: string, up: number) => {
    const s = addSketch(d, { kind: "world", plane: "XY", offset: up }, id);
    return updateSketch(s, id, (k: Sketch) => drawRectangle(k, [0, 0], [10, 10]).sketch);
  };
  let d = square(newDoc("Tower"), "s0", 0);
  d = addExtrude(d, { sketch: "s0", seeds: [[5, 5]], distance: 10, direction: "one", operation: "new" }, "x0", "body");
  for (let k = 1; k < 10; k++) {
    d = square(d, `s${k}`, 10 * k);
    d = addExtrude(d, { sketch: `s${k}`, seeds: [[5, 5]], distance: 10, direction: "one", operation: "join", target: "body" }, `x${k}`);
  }
  return d;
}

describe("exports of the model (#80, #81, #86)", () => {
  it("exports the timeline test model to STL with the B-rep's volume, on the bed", () => {
    const d = tower();
    const r = x.export({ doc: d, bodies: null, format: "stl", deflection: DEFLECTION.normal, name: "Tower" });
    expect(r.files.map((f) => f.name)).toEqual(["Tower.stl"]);
    const t = readStl(r.files[0]!.data);
    expect(Math.abs(meshVolume(t) - 10_000) / 10_000).toBeLessThan(0.005);
    expect(Math.min(...[...t].filter((_, i) => i % 3 === 2))).toBe(0);
  });

  it("matches a curved body's volume to 0.5% at Normal and 0.1% at Fine", () => {
    const d = addPart(newDoc("Can"), "cylinder", "c");
    const exact = m.build(d).bodies[0]!.measure.volume;
    for (const [q, tol] of [
      [DEFLECTION.normal, 0.005],
      [DEFLECTION.fine, 0.001],
    ] as const) {
      const t = readStl(x.export({ doc: d, bodies: null, format: "stl", deflection: q, name: "Can" }).files[0]!.data);
      expect(Math.abs(meshVolume(t) - exact) / exact).toBeLessThan(tol);
    }
  });

  it("estimates more triangles at Fine than at Draft, and the export matches the estimate", () => {
    const d = addPart(newDoc("Ball"), "sphere", "s");
    const draft = x.estimate({ doc: d, bodies: null, format: "stl", deflection: DEFLECTION.draft });
    const fine = x.estimate({ doc: d, bodies: null, format: "stl", deflection: DEFLECTION.fine });
    expect(fine.triangles).toBeGreaterThan(draft.triangles);
    const r = x.export({ doc: d, bodies: null, format: "stl", deflection: DEFLECTION.fine, name: "Ball" });
    expect(r.triangles).toBe(fine.triangles);
    expect(r.files[0]!.data.byteLength).toBe(fine.bytes);
  });

  it("writes one 3MF object per body, or one file per body, and skips hole shapes", () => {
    let d = addPart(newDoc("Kit"), "box", "a");
    d = addPart(d, "cylinder", "b");
    d = addPart(d, "sphere", "h");
    d = setLook(d, ["h"], () => ({ hole: true }));
    const r = x.export({ doc: d, bodies: null, format: "3mf", deflection: DEFLECTION.draft, name: "Kit" });
    expect(r.skipped).toBe(1);
    expect(read3mf(r.files[0]!.data).map((b) => b.name)).toEqual(["Box 1", "Cylinder 1"]);
    const each = x.export({ doc: d, bodies: null, format: "stl", deflection: DEFLECTION.draft, separate: true, name: "Kit" });
    expect(each.files.map((f) => f.name)).toEqual(["Kit-Box 1.stl", "Kit-Cylinder 1.stl"]);
    expect(() => x.estimate({ doc: d, bodies: ["h"], format: "stl", deflection: 0.1 })).toThrow("Only hole shapes are chosen");
  });

  it("leaves reference bodies out (#185)", () => {
    let d = addPart(newDoc("Mount"), "box", "a");
    d = addPart(d, "cylinder", "servo");
    d = setLook(d, ["servo"], () => ({ reference: true }));
    const r = x.export({ doc: d, bodies: null, format: "3mf", deflection: DEFLECTION.draft, name: "Mount" });
    expect(r.skipped).toBe(1);
    expect(read3mf(r.files[0]!.data).map((b) => b.name)).toEqual(["Box 1"]);
    expect(() => x.estimate({ doc: d, bodies: ["servo"], format: "stl", deflection: 0.1 })).toThrow("Reference bodies aren't exported");
  });

  it("round-trips the timeline test model through STEP with the same volume and faces", () => {
    const d = tower();
    const built = m.build(d).bodies[0]!.measure;
    const r = x.export({ doc: d, bodies: null, format: "step", deflection: 0, name: "Tower" });
    expect(r.files[0]!.name).toBe("Tower.step");
    const back = readStep(oc, r.files[0]!.data);
    expect(back).toHaveLength(1);
    const got = measure(oc, back[0]!.shape);
    expect(Math.abs(got.volume - built.volume)).toBeLessThan(1e-6 * built.volume);
    expect(got.faces).toBe(built.faces);
    expect(x.estimate({ doc: d, bodies: null, format: "step", deflection: 0 })).toMatchObject({ solids: 1, triangles: 0 });
  });
});
