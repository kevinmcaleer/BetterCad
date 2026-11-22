import { beforeAll, describe, expect, it } from "vitest";
import { drawRectangle, type Sketch } from "@bettercad/sketch";
import { Solver } from "@bettercad/sketch/solver";
import {
  addParam,
  addSketch,
  dimensionLoop,
  nameDimensions,
  newDoc,
  paramNameProblem,
  paramScope,
  rebindDimensions,
  relinkSketches,
  updateSketch,
  upgradeDoc,
  type ModelDoc,
  type SketchFeature,
} from "./document";
import { dimensionNameProblem, renameDimension } from "./dimNames";

let solver: Solver;
beforeAll(async () => {
  solver = await Solver.load();
}, 60_000);
const solve = (s: Sketch) => {
  const r = solver.solve(s);
  return r.status === "ok" || r.status === "redundant" ? r.sketch : null;
};

/** Two sketches, each a rectangle with a width and a height size. */
function model(): ModelDoc {
  let d = addSketch(newDoc(), { kind: "world", plane: "XY", offset: 0 }, "a");
  d = updateSketch(d, "a", (s) => solve(drawRectangle(s, [0, 0], [40, 20], { width: 40, height: 20 }).sketch)!);
  d = addSketch(d, { kind: "world", plane: "XZ", offset: 0 }, "b");
  return updateSketch(d, "b", (s) => solve(drawRectangle(s, [0, 0], [10, 5], { width: 10, height: 5 }).sketch)!);
}
const sk = (d: ModelDoc, id: string) => (d.features.find((f) => f.id === id) as SketchFeature).sketch;
const names = (d: ModelDoc, id: string) => sk(d, id).dimensions.map((x) => x.name);
const setExpr = (d: ModelDoc, id: string, name: string, expression: string) =>
  updateSketch(d, id, (s) => ({ ...s, dimensions: s.dimensions.map((x) => (x.name === name ? { ...x, expression } : x)) }));
const width = (s: Sketch) => {
  const xs = s.entities.flatMap((e) => (e.kind === "point" ? [e.x] : []));
  return Math.max(...xs) - Math.min(...xs);
};

describe("sketch size names", () => {
  it("names sizes d1, d2… across the model as they are made", () => {
    const d = model();
    expect(names(d, "a")).toEqual(["d1", "d2"]);
    expect(names(d, "b")).toEqual(["d3", "d4"]);
    expect(paramScope(d)).toMatchObject({ d1: 40, d2: 20, d3: 10, d4: 5 });
  });

  it("names the sizes of an old file on load, and keeps a copied sketch's names apart", () => {
    const d = model();
    const bare = {
      ...d,
      features: d.features.map((f) =>
        f.type === "sketch" ? { ...f, sketch: { ...f.sketch, dimensions: f.sketch.dimensions.map(({ name: _n, ...x }) => x) } } : f,
      ),
    };
    const loaded = upgradeDoc(JSON.parse(JSON.stringify(bare)) as Record<string, unknown>);
    expect(names(loaded, "a")).toEqual(["d1", "d2"]);
    expect(names(loaded, "b")).toEqual(["d3", "d4"]);
    const copied = { ...d, features: d.features.map((f) => (f.id === "b" && f.type === "sketch" ? { ...f, sketch: sk(d, "a") } : f)) };
    expect(names(nameDimensions(copied), "b")).toEqual(["d3", "d4"]);
    expect(nameDimensions(d)).toBe(d);
  });

  it("steers clear of parameter names", () => {
    let d = addParam(newDoc(), { name: "d1", expression: "3" });
    d = addSketch(d, { kind: "world", plane: "XY", offset: 0 }, "a");
    d = updateSketch(d, "a", (s) => drawRectangle(s, [0, 0], [40, 20], { width: 40, height: 20 }).sketch);
    expect(names(d, "a")).toEqual(["d2", "d3"]);
    expect(paramNameProblem(d, "d2")).toBe("d2 is the name of a sketch size");
  });

  it("links a size to another in the same sketch and in another sketch", () => {
    let d = setExpr(model(), "a", "d2", "d1 / 2");
    d = setExpr(d, "b", "d3", "d2 + 1");
    d = updateSketch(d, "a", (s) => ({ ...s, dimensions: s.dimensions.map((x) => (x.name === "d1" ? { ...x, expression: "60", value: 60 } : x)) }));
    d = relinkSketches(d, solve);
    expect(sk(d, "a").dimensions.map((x) => x.value)).toEqual([60, 30]);
    expect(sk(d, "b").dimensions[0]!.value).toBe(31);
    expect(width(sk(d, "b"))).toBeCloseTo(31, 6);
  });

  it("works a sketch's own linked sizes out before it is solved", () => {
    const d = setExpr(model(), "a", "d2", "d1 * 2");
    const s = sk(d, "a");
    expect(rebindDimensions(s, paramScope(d)).dimensions.map((x) => x.value)).toEqual([40, 80]);
    expect(rebindDimensions(s, paramScope(d)).dimensions).not.toBe(s.dimensions);
  });

  it("refuses sizes that go round in a ring", () => {
    const d = setExpr(model(), "a", "d2", "d1 * 2");
    const id = (n: string) => sk(d, "a").dimensions.find((x) => x.name === n)!.id;
    expect(dimensionLoop(d, id("d1"), "d2 + 1")).toBe("d1 and d2 depend on each other");
    expect(dimensionLoop(d, id("d1"), "d1 + 1")).toBe("d1 uses itself");
    expect(dimensionLoop(d, id("d1"), "d3 + 1")).toBeNull();
  });

  it("renames a size everywhere it is used, and checks the name", () => {
    let d = setExpr(model(), "b", "d3", "d1 + 1");
    const id = sk(d, "a").dimensions[0]!.id;
    expect(dimensionNameProblem(d, id, "d3")).toBe("There is already a size called d3");
    expect(dimensionNameProblem(d, id, "2x")).toBe("Use letters, digits and _, starting with a letter");
    expect(dimensionNameProblem(d, id, "wheel")).toBeNull();
    d = renameDimension(d, id, "wheel");
    expect(names(d, "a")).toEqual(["wheel", "d2"]);
    expect(sk(d, "b").dimensions[0]!.expression).toBe("wheel + 1");
  });

  it("gives what used a deleted size the number it stood for", () => {
    let d = setExpr(model(), "b", "d3", "d1 + 1");
    d = updateSketch(d, "a", (s) => ({ ...s, dimensions: s.dimensions.filter((x) => x.name !== "d1") }));
    expect(sk(d, "b").dimensions[0]!.expression).toBe("40 + 1");
  });
});
