import { beforeAll, describe, expect, it } from "vitest";
import { addParam, addPart, build, changeParts, newDoc, paramUses, removeParamProblem, setExpr, updateParam, type ModelDoc } from "./document";
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
