import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./oc";
import { box, cylinder, measure, sphere } from "./shapes";
import { DEFLECTION, readStep, triangles, writeStep } from "./export";
import { meshVolume } from "../export/mesh";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

describe("export from the B-rep (#80, #81)", () => {
  it("triangulates a closed solid whose mesh holds the B-rep's volume", () => {
    for (const shape of [box(oc, { x: 10, y: 20, z: 30 }), cylinder(oc, { x: 10, y: 10, z: 20 }), sphere(oc, { x: 20, y: 20, z: 20 })]) {
      const exact = measure(oc, shape).volume;
      const normal = meshVolume(triangles(oc, shape, DEFLECTION.normal));
      const fine = meshVolume(triangles(oc, shape, DEFLECTION.fine));
      expect(Math.abs(normal - exact) / exact).toBeLessThan(0.005);
      expect(Math.abs(fine - exact) / exact).toBeLessThan(0.001);
    }
  });

  it("finer resolution makes more triangles", () => {
    const s = cylinder(oc, { x: 20, y: 20, z: 10 });
    const n = (d: number) => triangles(oc, s, d).length / 9;
    expect(n(DEFLECTION.fine)).toBeGreaterThan(n(DEFLECTION.normal));
    expect(n(DEFLECTION.normal)).toBeGreaterThan(n(DEFLECTION.draft));
  });

  it("writes STEP AP214 in millimetres with body names, and reads it back", () => {
    const a = box(oc, { x: 10, y: 10, z: 10 });
    const b = cylinder(oc, { x: 6, y: 6, z: 8 });
    const bytes = writeStep(oc, [
      { name: "Bracket", shape: a },
      { name: "Peg", shape: b },
    ]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toMatch(/^ISO-10303-21;/);
    expect(text).toContain("AUTOMOTIVE_DESIGN");
    expect(text).toContain("'Bracket'");
    expect(text).toContain("'Peg'");
    expect(text).toMatch(/SI_UNIT\(\.MILLI\.,\.METRE\.\)/);
    const back = readStep(oc, bytes);
    expect(back).toHaveLength(2);
    const vols = back.map((x) => measure(oc, x.shape).volume).sort((p, q) => p - q);
    expect(vols[0]).toBeCloseTo(measure(oc, b).volume, 6);
    expect(vols[1]).toBeCloseTo(1000, 6);
  });
});
