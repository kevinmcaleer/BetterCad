import { beforeAll, describe, expect, it } from "vitest";
import { addPart, addPattern, build, changeParts, dependsOn, featureParts, featureSummary, newDoc, updatePattern, type ModelDoc } from "./document";
import { copiesPer, movePoint, patternMoves, patternProblem, type CopyMove } from "./pattern";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

/** A 20 × 10 × 10 mm box standing with its centre at x = 15. */
function boxAt15(): ModelDoc {
  const d = changeParts(addPart(newDoc(), "box", "a"), ["a"], "size", { x: 20, y: 10, z: 10 });
  return changeParts(d, ["a"], "position", { x: 15, y: 0, z: 0 });
}

const bbox = (b: ModelBuilder, doc: ModelDoc, id: string) => b.solid(build(doc).parts.find((p) => p.id === id)!).body.measure;

describe("pattern maths (#69)", () => {
  it("mirrors, turns and moves points", () => {
    const p = { x: 15, y: 2, z: 3 };
    expect(movePoint(p, { mirror: { origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } } })).toEqual({ x: -15, y: 2, z: 3 });
    expect(movePoint(p, { mirror: { origin: { x: 5, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } } })).toEqual({ x: -5, y: 2, z: 3 });
    expect(movePoint(p, { turn: { origin: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, deg: 90 } })).toEqual({ x: -2, y: 15, z: 3 });
    expect(movePoint(p, { move: { x: 1, y: 1, z: 1 } })).toEqual({ x: 16, y: 3, z: 4 });
  });

  it("lays out rows, grids and circles, leaving the original out", () => {
    const doc = addPattern(boxAt15(), { parts: ["a"], kind: "rect", count1: 3, spacing1: 25, count2: 2, spacing2: 15 }, "f");
    const f = doc.features.at(-1)! as Parameters<typeof patternMoves>[0];
    expect(copiesPer(f)).toBe(5);
    expect(patternMoves(f).map((m) => (m as { move: unknown }).move)).toEqual([
      { x: 25, y: 0, z: 0 },
      { x: 50, y: 0, z: 0 },
      { x: 0, y: 15, z: 0 },
      { x: 25, y: 15, z: 0 },
      { x: 50, y: 15, z: 0 },
    ]);
    const turns = (count: number, angle: number) =>
      patternMoves({ ...f, kind: "circle", count, angle }).map((m) => (m as Extract<CopyMove, { turn: unknown }>).turn.deg);
    expect(turns(4, 360)).toEqual([90, 180, 270]);
    expect(turns(3, 90)).toEqual([45, 90]);
  });

  it("names what's wrong", () => {
    const f = addPattern(boxAt15(), { parts: ["a"], kind: "rect" }, "f").features.at(-1)! as Parameters<typeof patternProblem>[0];
    expect(patternProblem(f)).toBeNull();
    expect(patternProblem({ ...f, count1: 1 })).toBe("Give it 2 or more copies in a direction");
    expect(patternProblem({ ...f, spacing1: 0 })).toBe("Give it a spacing other than 0 mm");
    expect(patternProblem({ ...f, count1: 2.5 })).toBe("Counts are whole numbers, 1 or more");
    expect(patternProblem({ ...f, count2: 2, dir2: "x" })).toBe("Pick two different directions");
    expect(patternProblem({ ...f, count1: 20, count2: 20 })).toBe("That's more than 100 copies. Use fewer.");
    expect(patternProblem({ ...f, kind: "circle", count: 1 })).toBe("Give it a count of 2 or more");
    expect(patternProblem({ ...f, kind: "circle", angle: 0 })).toBe("Give it an angle from 1° to 360°");
  });
});

describe("mirror and patterns on the timeline (#69)", () => {
  it("a mirror makes a second body on the far side of the plane, which then moves like any other", () => {
    let doc = addPattern(boxAt15(), { parts: ["a"], kind: "mirror", plane: "YZ" }, "m");
    const b = build(doc);
    expect(b.parts.map((p) => p.name)).toEqual(["Box 1", "Box 1 mirrored"]);
    expect(featureParts(doc.features.at(-1)!)).toEqual(["m.a.0"]);
    expect(featureSummary(doc, doc.features.at(-1)!)).toBe("Box 1 across YZ");
    expect(doc.features.at(-1)!.name).toBe("Mirror 1");
    const kb = new ModelBuilder(oc);
    const m = bbox(kb, doc, "m.a.0");
    expect(m.volume).toBeCloseTo(2000, 3);
    expect(m.bbox.min[0]).toBeCloseTo(-25, 6);
    expect(m.bbox.max[0]).toBeCloseTo(-5, 6);
    doc = changeParts(doc, ["m.a.0"], "position", { x: -35 });
    expect(bbox(kb, doc, "m.a.0").bbox.min[0]).toBeCloseTo(-45, 6);
    // Changing the original changes the mirror.
    doc = changeParts(boxAt15(), ["a"], "size", { x: 10 });
    doc = addPattern(doc, { parts: ["a"], kind: "mirror", plane: "YZ" }, "m");
    expect(bbox(kb, doc, "m.a.0").bbox.min[0]).toBeCloseTo(-20, 6);
  });

  it("joined copies make one body with the volume of all of them", () => {
    const doc = addPattern(boxAt15(), { parts: ["a"], kind: "circle", count: 4, join: true }, "c");
    const b = build(doc);
    expect(b.parts.map((p) => p.id)).toEqual(["a"]);
    expect(b.parts[0]!.ops).toHaveLength(3);
    const m = bbox(new ModelBuilder(oc), doc, "a");
    // Four 20 × 10 × 10 arms from x 5 to 25, round Z: they don't touch, so the volume is four boxes'.
    expect(m.volume).toBeCloseTo(8000, 1);
    expect(m.bbox.min[0]).toBeCloseTo(-25, 4);
    expect(m.bbox.min[1]).toBeCloseTo(-25, 4);
  });

  it("a rectangular copy is still a box you can resize, and changing the count keeps the other copies' ids", () => {
    let doc = addPattern(boxAt15(), { parts: ["a"], kind: "rect", count1: 3, spacing1: 30 }, "r");
    let parts = build(doc).parts;
    expect(parts.map((p) => [p.id, p.kind, p.position.x])).toEqual([
      ["a", "box", 15],
      ["r.a.0", "box", 45],
      ["r.a.1", "box", 75],
    ]);
    doc = updatePattern(doc, "r", { count1: 4 });
    parts = build(doc).parts;
    expect(parts.map((p) => p.id)).toEqual(["a", "r.a.0", "r.a.1", "r.a.2"]);
    // Switching to a mirror renames the step.
    doc = updatePattern(doc, "r", { kind: "mirror" });
    expect(doc.features.at(-1)!.name).toBe("Mirror 1");
  });

  it("a step that moves a copy needs the pattern before it", () => {
    let doc = addPattern(boxAt15(), { parts: ["a"], kind: "mirror" }, "m");
    doc = changeParts(doc, ["m.a.0"], "position", { y: 20 });
    const move = doc.features.at(-1)!;
    expect(dependsOn(doc, move.id)).toContain("m");
    expect(dependsOn(doc, "m")).toContain(doc.features[0]!.id);
  });

  it("fails with the reason when its settings can't be made", () => {
    const doc = addPattern(boxAt15(), { parts: ["a"], kind: "rect", spacing1: 0 }, "r");
    expect(build(doc).failed.get("r")).toBe("Give it a spacing other than 0 mm");
    expect(build(doc).parts).toHaveLength(1);
  });
});
