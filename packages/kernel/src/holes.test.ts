import { beforeAll, describe, expect, it } from "vitest";
import type { Frame } from "@bettercad/sketch";
import { addHole, addPart, build, changeParts, featureSummary, newDoc, type HoleStepParams, type ModelDoc } from "./document";
import { holeSection, resolveHole } from "./holes";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

const TOP: Frame = { origin: [0, 0, 20], x: [1, 0, 0], normal: [0, 0, 1] };
const hole = (p: Partial<HoleStepParams> = {}): HoleStepParams => ({
  part: "b",
  frame: TOP,
  points: [[0, 0]],
  size: "M3",
  fit: "printed",
  head: "none",
  depth: null,
  ...p,
});
const bodies = (d: ModelDoc) => new ModelBuilder(oc).build(d);
const cyl = (d: number, h: number) => Math.PI * (d / 2) ** 2 * h;

describe("hole settings", () => {
  it("resolves sizes, fits and heads from the screw table", () => {
    expect(resolveHole({ size: "M3", fit: "printed", head: "none", depth: null })).toEqual({ diameter: 3.4 });
    expect(resolveHole({ size: "M3", fit: "tap", head: "none", depth: null })).toEqual({ diameter: 2.5 });
    expect(resolveHole({ size: "custom", diameter: 7, fit: "printed", head: "none", depth: null })).toEqual({ diameter: 7 });
    expect(resolveHole({ size: "custom", fit: "printed", head: "none", depth: null })).toEqual({ error: "Give the hole a diameter above 0 mm" });
    const cb = resolveHole({ size: "M4", fit: "printed", head: "counterbore", depth: 6 });
    expect(cb).toMatchObject({ diameter: 4.4, head: { kind: "counterbore", diameter: 7.4, depth: 4.2 } });
    const cs = resolveHole({ size: "M3", fit: "printed", head: "countersink", depth: null }) as { head: { depth: number } };
    // A 90° countersink is as deep as it is wide at the rim, less the hole, over two.
    expect(cs.head.depth).toBeCloseTo((6.72 - 3.4) / 2, 6);
  });

  it("draws the section closed along the axis", () => {
    const s = holeSection({ diameter: 4 }, 10);
    expect(s[0]).toEqual([0, -0.05]);
    expect(s.at(-1)).toEqual([0, 10]);
  });
});

describe("hole steps", () => {
  it("puts two M3 printed-fit holes right through a 20 mm box", () => {
    const d = addHole(
      addPart(newDoc(), "box", "b"),
      hole({
        points: [
          [-5, 0],
          [5, 0],
        ],
      }),
      "h1",
    );
    expect(featureSummary(d, d.features[1]!)).toBe("2 holes, M3, 3.4 mm, through, Box 1");
    const r = bodies(d);
    expect(r.failed).toEqual([]);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(8000 - 2 * cyl(3.4, 20), 1);
    // Two bores add two faces.
    expect(r.bodies[0]!.measure.faces).toBe(8);
  });

  it("stops a blind hole at its depth", () => {
    const d = addHole(addPart(newDoc(), "box", "b"), hole({ depth: 6 }), "h1");
    expect(bodies(d).bodies[0]!.measure.volume).toBeCloseTo(8000 - cyl(3.4, 6), 1);
  });

  it("counterbores an M4 for its head", () => {
    const d = addHole(addPart(newDoc(), "box", "b"), hole({ size: "M4", head: "counterbore", depth: 10 }), "h1");
    expect(bodies(d).bodies[0]!.measure.volume).toBeCloseTo(8000 - cyl(7.4, 4.2) - cyl(4.4, 10 - 4.2), 1);
  });

  it("moves with its part when the part moves later", () => {
    let d = addHole(addPart(newDoc(), "box", "b"), hole(), "h1");
    d = changeParts(d, ["b"], "position", { x: 30 });
    const r = bodies(d);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(8000 - cyl(3.4, 20), 1);
  });

  it("explains a hole it can't make", () => {
    expect(build(addHole(addPart(newDoc(), "box", "b"), hole({ points: [] }), "h1")).failed.get("h1")).toBe("Click the face to place a hole");
    expect(build(addHole(addPart(newDoc(), "box", "b"), hole({ depth: 0 }), "h1")).failed.get("h1")).toBe("Give it a depth above 0 mm, or choose Through all");
  });
});
