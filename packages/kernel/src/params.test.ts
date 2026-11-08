import { beforeAll, describe, expect, it } from "vitest";
import { Solver, drawRectangle, type Sketch } from "@bettercad/sketch";
import {
  addParam,
  addPart,
  addSketch,
  build,
  changeParts,
  newDoc,
  paramUses,
  relinkSketches,
  removeParam,
  removeParamProblem,
  setExpr,
  updateParam,
  updateSketch,
  type ModelDoc,
  type SketchFeature,
} from "./document";
import { evaluateParams, namesIn, renameIn, setPath } from "./params";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

const P = (name: string, expression: string, unit: "mm" | "deg" | "none" = "mm") => ({ id: name, name, expression, unit });

describe("parameter evaluation", () => {
  it("works parameters out in order, whatever order they are listed", () => {
    const r = evaluateParams([P("total", "width * 2 + gap"), P("width", "20"), P("gap", "5 mm")]);
    expect(r.values).toEqual({ total: 45, width: 20, gap: 5 });
    expect(r.errors.size).toBe(0);
  });

  it("names a cycle", () => {
    const r = evaluateParams([P("a", "b + 1"), P("b", "a * 2"), P("c", "3")]);
    expect(r.errors.get("a")).toBe("`a` and `b` depend on each other");
    expect(r.errors.get("b")).toBe("`a` and `b` depend on each other");
    expect(r.values).toEqual({ c: 3 });
  });

  it("refuses a length made from an angle, and names a missing value", () => {
    const r = evaluateParams([P("turn", "45", "deg"), P("len", "turn + 3"), P("ratio", "turn / 9", "none"), P("x", "nope * 2")]);
    expect(r.errors.get("len")).toBe("turn is an angle, and len is a length");
    expect(r.values.ratio).toBe(5);
    expect(r.errors.get("x")).toBe("No value called nope");
  });

  it("reads names but not units", () => {
    expect(namesIn("width + 5 mm - 2in + deg_x")).toEqual(["width", "deg_x"]);
    expect(renameIn("w + width + w_2", "w", "depth")).toBe("depth + width + w_2");
    expect(setPath({ size: { x: 1, y: 2 } }, "size.x", 9)).toEqual({ size: { x: 9, y: 2 } });
  });
});

describe("parameters in the model", () => {
  /** A box whose width is the parameter `width`. */
  function model(width: string): ModelDoc {
    let d = addParam(addPart(newDoc(), "box", "b"), { name: "width", expression: width }, "pw");
    d = changeParts(d, ["b"], "size", { x: 20 });
    return setExpr(d, d.features[1]!.id, "size.x", "width");
  }

  it("rebuilds to the right volume when the parameter changes", () => {
    const vol = (d: ModelDoc) => new ModelBuilder(oc).build(d).bodies[0]!.measure.volume;
    const d = model("30");
    expect(vol(d)).toBeCloseTo(30 * 20 * 20, 6);
    expect(vol(updateParam(d, "pw", { expression: "45" }))).toBeCloseTo(45 * 20 * 20, 6);
  });

  it("writes a new name into the expressions that use it, and won't delete one in use", () => {
    let d = addParam(model("30"), { name: "half", expression: "width / 2" }, "ph");
    d = updateParam(d, "pw", { name: "w" });
    expect(d.features[1]!.exprs).toEqual({ "size.x": "w" });
    expect(d.params!.find((p) => p.id === "ph")!.expression).toBe("w / 2");
    expect(paramUses(d, "w").features).toHaveLength(1);
    expect(removeParamProblem(d, "pw")).toBe("w is used by Resize 1 and half");
    expect(removeParamProblem(d, "ph")).toBeNull();
  });

  it("flags a step whose expression can't be worked out", () => {
    const m = model("30");
    const d = setExpr(m, m.features[1]!.id, "size.y", "missing + 1");
    expect(build(d).failed.get(d.features[1]!.id)).toBe("No value called missing");
  });
});

describe("parameters in sketch sizes", () => {
  let solver: Solver;
  beforeAll(async () => {
    solver = await Solver.load();
  });
  const solve = (s: Sketch) => {
    const r = solver.solve(s);
    return r.status === "ok" || r.status === "redundant" ? r.sketch : null;
  };

  /** A 40 × 20 rectangle sketch whose width is `width * 2` and height is `height`. */
  function model(): ModelDoc {
    let d = addParam(newDoc(), { name: "width", expression: "20" }, "pw");
    d = addParam(d, { name: "height", expression: "10" }, "ph");
    d = addSketch(d, { kind: "world", plane: "XY", offset: 0 }, "s");
    return updateSketch(d, "s", (s) => {
      const r = drawRectangle(s, [0, 0], [40, 20], { width: 40, height: 20 });
      const exprs = ["width * 2", "height + 10"];
      return solve({ ...r.sketch, dimensions: r.sketch.dimensions.map((dm, i) => ({ ...dm, expression: exprs[i]! })) })!;
    });
  }
  const sketchOf = (d: ModelDoc) => (d.features.find((f) => f.id === "s") as SketchFeature).sketch;
  const xs = (s: Sketch) => s.entities.flatMap((e) => (e.kind === "point" ? [Math.round(e.x * 1e6) / 1e6] : []));
  const ys = (s: Sketch) => s.entities.flatMap((e) => (e.kind === "point" ? [Math.round(e.y * 1e6) / 1e6] : []));

  it("re-solves a sketch when a parameter its sizes use changes", () => {
    const d = relinkSketches(updateParam(model(), "pw", { expression: "30" }), solve);
    const s = sketchOf(d);
    expect(s.dimensions.map((x) => x.value)).toEqual([60, 20]);
    expect(Math.max(...xs(s)) - Math.min(...xs(s))).toBeCloseTo(60, 6);
    expect(Math.max(...ys(s)) - Math.min(...ys(s))).toBeCloseTo(20, 6);
  });

  it("leaves the document alone when nothing moved, and keeps the old size when an expression breaks", () => {
    const m = model();
    expect(relinkSketches(m, solve)).toBe(m);
    const broken = removeParam(m, "ph");
    expect(relinkSketches(broken, solve)).toBe(broken);
  });

  it("counts a sketch as a use, and renames inside its sizes", () => {
    let d = model();
    expect(paramUses(d, "width").features.map((f) => f.id)).toEqual(["s"]);
    expect(removeParamProblem(d, "pw")).toBe("width is used by Sketch 1");
    d = updateParam(d, "pw", { name: "w" });
    expect(sketchOf(d).dimensions.map((x) => x.expression)).toEqual(["w * 2", "height + 10"]);
  });
});
