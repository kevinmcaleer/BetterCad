import { addParam, addPart, changeParts, newDoc, type Feature, type ModelDoc } from "../state/document";
import { checkModelParam, modelParams, setModelParam } from "./modelParams";

function withSketch(doc: ModelDoc): ModelDoc {
  const sketch: Feature = {
    id: "s",
    type: "sketch",
    name: "Sketch 1",
    sketch: {
      plane: { kind: "world", plane: "XY" },
      entities: [],
      constraints: [],
      dimensions: [
        { id: "d1", kind: "length", refs: [], expression: "width * 2", value: 40, driving: true, labelOffset: { x: 0, y: 0 } },
        { id: "d2", kind: "angle", refs: [], expression: "30", value: 30, driving: false, labelOffset: { x: 0, y: 0 } },
      ],
    },
  } as unknown as Feature;
  return { ...doc, features: [...doc.features, sketch] };
}

describe("modelParams", () => {
  it("lists each step's sizes in timeline order, with sketch dimensions", () => {
    let d = changeParts(addPart(newDoc(), "box", "a"), ["a"], "size", { x: 30 });
    d = withSketch(d);
    const steps = modelParams(d);
    expect(steps.map((s) => s.feature.name)).toEqual(["Box 1", "Resize 1", "Sketch 1"]);
    expect(steps[0]!.params.map((p) => p.label)).toEqual(["Width", "Depth", "Height"]);
    expect(steps[1]!.params).toEqual([{ path: "size.x", label: "Width", expression: "30", value: 30, unit: "mm" }]);
    const dims = steps[2]!.params;
    expect(dims.map((p) => [p.label, p.expression, p.unit, !!p.readOnly])).toEqual([
      ["Length 1", "width * 2", "mm", false],
      ["Angle 1", "30", "deg", true],
    ]);
  });

  it("puts a number in the field and keeps an expression only when it uses a parameter", () => {
    let d = addParam(addPart(newDoc(), "box", "a"), { name: "w", expression: "12" });
    const id = d.features[0]!.id;
    d = setModelParam(d, id, "part.size.x", "w + 1", 13);
    let f = d.features[0]!;
    expect(f.type === "add" && f.part.size.x).toBe(13);
    expect(f.exprs).toEqual({ "part.size.x": "w + 1" });
    d = setModelParam(d, id, "part.size.x", "8", 8);
    f = d.features[0]!;
    expect(f.type === "add" && f.part.size.x).toBe(8);
    expect(f.exprs).toBeUndefined();
  });

  it("sets a sketch dimension's expression and value", () => {
    const d = setModelParam(withSketch(newDoc()), "s", "dim:d1", "50", 50);
    const f = d.features[0]!;
    expect(f.type === "sketch" && f.sketch.dimensions[0]).toMatchObject({ expression: "50", value: 50 });
  });

  it("checks what a size can take", () => {
    const d = withSketch(addPart(newDoc(), "box", "a"));
    const box = d.features[0]!;
    const sk = d.features[1]!;
    expect(checkModelParam(box, "part.size.x", "w * 2", { w: 4 })).toEqual({ value: 8 });
    expect(checkModelParam(box, "part.size.x", "0", {})).toEqual({ problem: "Use a size above 0" });
    expect(checkModelParam(box, "part.size.x", "nope", {})).toHaveProperty("problem");
    expect(checkModelParam(sk, "dim:d2", "200", {})).toEqual({ problem: "Use an angle under 180°" });
    const pattern = { id: "p", name: "Pattern 1", type: "pattern" } as unknown as Feature;
    expect(checkModelParam(pattern, "count1", "2.5", {})).toEqual({ problem: "Use a whole number, 1 or more" });
    const move = { id: "m", name: "Move 1", type: "move" } as unknown as Feature;
    expect(checkModelParam(move, "position.x", "-5", {})).toEqual({ value: -5 });
  });
});
