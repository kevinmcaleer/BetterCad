import { beforeAll, describe, expect, it } from "vitest";
import {
  addHole,
  addJoint,
  addLink,
  addPart,
  addPattern,
  build,
  changeParts,
  dependsOn,
  featureParts,
  featureSummary,
  mirrorableFeatures,
  newDoc,
  updatePattern,
  type ModelDoc,
  type PatternFeature,
  type Vec3,
} from "./document";
import { copiesPer, mirrorFace, mirrorPlane, movePoint, moveToLocal, patternMoves, patternProblem, undoMove, type CopyMove } from "./pattern";
import { addConstruct } from "./document";
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

describe("Mirror across a face, of features and of a component", () => {
  const X: Vec3 = { x: 1, y: 0, z: 0 };

  it("mirrors across a picked face, and the plane follows the face's body when it moves", () => {
    // Box a spans x 5 to 25; its +X face is at x 25, so the mirror image spans 25 to 45.
    const start = boxAt15();
    const a = build(start).parts[0]!;
    let doc = addPattern(start, { parts: ["a"], kind: "mirror", face: mirrorFace(a, 3, { x: 25, y: 0, z: 0 }, X) }, "m");
    expect(featureSummary(doc, doc.features.at(-1)!)).toBe("Box 1 across a face of Box 1");
    const kb = new ModelBuilder(oc);
    let m = bbox(kb, doc, "m.a.0");
    expect(m.bbox.min[0]).toBeCloseTo(25, 6);
    expect(m.bbox.max[0]).toBeCloseTo(45, 6);
    // An offset moves the plane out along the face's normal.
    doc = updatePattern(doc, "m", { offset: 5 });
    expect(bbox(kb, doc, "m.a.0").bbox.min[0]).toBeCloseTo(35, 6);
    // Moving the box before the mirror carries the face, and so the copy.
    doc = updatePattern(doc, "m", { offset: 0 });
    doc = { ...doc, features: [doc.features[0]!, ...changeParts(boxAt15(), ["a"], "position", { x: 30 }).features.slice(1), doc.features.at(-1)!] };
    m = bbox(kb, doc, "m.a.0");
    expect(m.bbox.min[0]).toBeCloseTo(40, 6);
    expect(m.bbox.max[0]).toBeCloseTo(60, 6);
  });

  it("follows a turned body's face", () => {
    let doc = changeParts(boxAt15(), ["a"], "rotation", { z: 90 });
    const a = build(doc).parts[0]!;
    // Turned 90° about Z round its centre (15, 0): it spans y -10 to 10, so its far face in +Y is at y 10.
    doc = addPattern(doc, { parts: ["a"], kind: "mirror", face: mirrorFace(a, 0, { x: 15, y: 10, z: 0 }, { x: 0, y: 1, z: 0 }) }, "m");
    const f = doc.features.at(-1) as PatternFeature;
    const w = mirrorPlane(f, build(doc).parts);
    expect(w).toEqual({ origin: { x: 15, y: 10, z: 0 }, normal: { x: 0, y: 1, z: 0 } });
  });

  it("says when the face's body is gone", () => {
    const start = boxAt15();
    const a = build(start).parts[0]!;
    let doc = addPart(start, "box", "b");
    doc = addPattern(doc, { parts: ["b"], kind: "mirror", face: mirrorFace(a, 3, { x: 25, y: 0, z: 0 }, X) }, "m");
    doc = { ...doc, features: doc.features.filter((g) => g.id !== doc.features[0]!.id) };
    expect(build(doc).failed.get("m")).toBe("The face it mirrors across is gone");
  });

  it("mirrors a hole onto the same body, across the body's middle", () => {
    // A 40 × 20 × 20 box at the origin with an M3 hole 10 mm right of centre; mirrored across YZ, it has two.
    let doc = changeParts(addPart(newDoc(), "box", "b"), ["b"], "size", { x: 40, y: 20, z: 20 });
    doc = addHole(
      doc,
      {
        part: "b",
        frame: { origin: [0, 0, 20], x: [1, 0, 0], normal: [0, 0, 1] },
        points: [[10, 0]],
        size: "M3",
        fit: "printed",
        offset: 0,
        head: "none",
        depth: null,
      },
      "h1",
    );
    expect(mirrorableFeatures(doc).map((f) => f.id)).toEqual(["h1"]);
    const kb = new ModelBuilder(oc);
    const one = bbox(kb, doc, "b").volume;
    doc = addPattern(doc, { parts: [], kind: "mirror", of: "features", features: ["h1"], plane: "YZ" }, "m");
    const f = doc.features.at(-1)!;
    expect(featureSummary(doc, f)).toBe("Hole 1 across YZ");
    expect(featureParts(f)).toEqual([]);
    expect(dependsOn(doc, "m")).toContain("h1");
    const b = build(doc);
    expect(b.failed.size).toBe(0);
    expect(b.parts).toHaveLength(1);
    const two = bbox(kb, doc, "b").volume;
    expect(16000 - two).toBeCloseTo(2 * (16000 - one), 1);
    expect(16000 - one).toBeGreaterThan(100);
    // Across a plane where the hole lands on itself, nothing more is cut.
    doc = updatePattern(doc, "m", { plane: "XZ" });
    expect(bbox(kb, doc, "b").volume).toBeCloseTo(one, 1);
  });

  it("mirrors a body a feature made as a whole body, and says when its features are gone", () => {
    let doc = addPattern(boxAt15(), { parts: [], kind: "mirror", of: "features", features: ["gone"] }, "m");
    expect(build(doc).failed.get("m")).toBe("The features it mirrors are gone");
    doc = updatePattern(doc, "m", { features: [] });
    expect(build(doc).failed.get("m")).toBe("Pick the features to mirror");
  });

  it("mirrors a component into a new component that joints can move", () => {
    let doc = addPart(boxAt15(), "box", "c");
    doc = changeParts(doc, ["c"], "position", { x: 15, y: 30 });
    doc = addLink(doc, ["a", "c"], "L1");
    doc = addPattern(doc, { parts: [], kind: "mirror", of: "component", link: "L1", plane: "YZ" }, "m");
    const f = doc.features.at(-1) as PatternFeature;
    expect(f.parts).toEqual(["a", "c"]);
    expect(featureParts(f)).toEqual(["m.a.0", "m.c.0"]);
    expect(featureSummary(doc, f)).toBe("Component 1 across YZ");
    expect(dependsOn(doc, "m")).toContain("L1");
    const b = build(doc);
    expect(b.links).toEqual([
      { id: "L1", name: "Component 1", parts: ["a", "c"] },
      { id: "m", name: "Component 1 mirrored", parts: ["m.a.0", "m.c.0"] },
    ]);
    expect(b.parts.find((p) => p.id === "m.c.0")!.position).toEqual({ x: -15, y: 30, z: 0 });
    doc = addJoint(doc, { kind: "revolute", child: "m", parent: "L1", origin: [0, 0, 0], axis: [0, 0, 1], lower: -90, upper: 90 }, "j");
    expect(build(doc).failed.get("j")).toBeUndefined();
  });
});

describe("Pattern of features, and round a construction axis", () => {
  /** A 40 × 20 × 20 box at the origin with an M3 hole 10 mm right of centre, made by step "h1". */
  function holedBox(): ModelDoc {
    const doc = changeParts(addPart(newDoc(), "box", "b"), ["b"], "size", { x: 40, y: 20, z: 20 });
    return addHole(
      doc,
      {
        part: "b",
        frame: { origin: [0, 0, 20], x: [1, 0, 0], normal: [0, 0, 1] },
        points: [[10, 0]],
        size: "M3",
        fit: "printed",
        offset: 0,
        head: "none",
        depth: null,
      },
      "h1",
    );
  }

  it("takes a world move into a turned part's own coordinates, and undoes it", () => {
    const part = { position: { x: 5, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 90 } };
    expect(moveToLocal({ move: { x: 10, y: 0, z: 0 } }, part)).toEqual({ move: { x: 0, y: -10, z: 0 } });
    const turn = moveToLocal({ turn: { origin: { x: 5, y: 3, z: 0 }, axis: { x: 0, y: 0, z: 1 }, deg: 90 } }, part) as Extract<CopyMove, { turn: unknown }>;
    expect(turn.turn).toEqual({ origin: { x: 3, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, deg: 90 });
    expect(undoMove(turn)).toEqual({ turn: { ...turn.turn, deg: -90 } });
    expect(undoMove({ move: { x: 1, y: 2, z: 3 } })).toEqual({ move: { x: -1, y: -2, z: -3 } });
  });

  it("copies a hole along a row on the same body, not the whole body", () => {
    const kb = new ModelBuilder(oc);
    let doc = holedBox();
    const one = 16000 - bbox(kb, doc, "b").volume;
    doc = addPattern(doc, { parts: [], kind: "rect", of: "features", features: ["h1"], count1: 3, spacing1: -10 }, "p");
    const f = doc.features.at(-1)!;
    expect(featureSummary(doc, f)).toBe("Hole 1, 3 along X at -10 mm");
    expect(featureParts(f)).toEqual([]);
    expect(dependsOn(doc, "p")).toContain("h1");
    const b = build(doc);
    expect(b.failed.size).toBe(0);
    expect(b.parts).toHaveLength(1);
    expect(16000 - bbox(kb, doc, "b").volume).toBeCloseTo(3 * one, 1);
  });

  it("turns a hole round Z, or round a construction axis, and says when the axis is gone", () => {
    const kb = new ModelBuilder(oc);
    let doc = holedBox();
    const one = 16000 - bbox(kb, doc, "b").volume;
    // A vertical axis 20 mm along X, on the box's end: where the planes x = 20 and XZ meet.
    doc = addConstruct(doc, { kind: "offset", refs: [{ origin: "YZ" }], value: 20 }, "pl");
    doc = addConstruct(doc, { kind: "twoPlanes", refs: [{ step: "pl" }, { origin: "XZ" }], value: 0 }, "ax");
    doc = addPattern(doc, { parts: [], kind: "circle", of: "features", features: ["h1"], count: 2, angle: 360 }, "p");
    // Round Z through the origin: the copy lands at x = -10, inside the box.
    expect(build(doc).failed.size).toBe(0);
    expect(16000 - bbox(kb, doc, "b").volume).toBeCloseTo(2 * one, 1);
    // Round the axis at x = 20: the copy lands at x = 30, off the box, so nothing more is cut.
    doc = updatePattern(doc, "p", { axisStep: "ax" });
    const axisName = doc.features.find((g) => g.id === "ax")!.name;
    expect(featureSummary(doc, doc.features.at(-1)!)).toBe(`Hole 1, 2 round ${axisName}`);
    expect(dependsOn(doc, "p")).toContain("ax");
    expect(build(doc).failed.size).toBe(0);
    expect(16000 - bbox(kb, doc, "b").volume).toBeCloseTo(one, 1);
    // A body pattern round the same axis turns the box half way round it.
    const bodies = addPattern(holedBox(), { parts: ["b"], kind: "circle", count: 2 }, "q");
    expect(build(bodies).parts).toHaveLength(2);
    doc = { ...doc, features: doc.features.filter((g) => g.id !== "ax") };
    expect(build(doc).failed.get("p")).toBe("The axis it turns round is gone");
  });

  it("asks for features when none are picked, and keeps its settings for when it is opened again", () => {
    let doc = addPattern(holedBox(), { parts: [], kind: "circle", of: "features", features: [], count: 4, angle: 90 }, "p");
    expect(build(doc).failed.get("p")).toBe("Pick the features to copy");
    doc = updatePattern(doc, "p", { features: ["h1"] });
    const f = doc.features.at(-1) as PatternFeature;
    expect(f).toMatchObject({ kind: "circle", of: "features", features: ["h1"], count: 4, angle: 90 });
  });
});
