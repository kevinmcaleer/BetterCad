import { applyCompletion, completeAt, evaluate, isExpression, ExprError } from "./expr";

describe("evaluate", () => {
  it("does arithmetic with the usual precedence", () => {
    expect(evaluate("40/2 + 5")).toBe(25);
    expect(evaluate("2 * (3 + 4)")).toBe(14);
    expect(evaluate("-3 + 10")).toBe(7);
    expect(evaluate("12.5")).toBe(12.5);
  });
  it("converts units to millimetres", () => {
    expect(evaluate("1in")).toBe(25.4);
    expect(evaluate("2 cm + 3mm")).toBe(23);
    expect(evaluate("15°")).toBe(15);
  });
  it("looks names up in the scope", () => {
    expect(evaluate("wall * 2", { wall: 1.6 })).toBeCloseTo(3.2);
  });
  it("explains what went wrong", () => {
    expect(() => evaluate("")).toThrow(ExprError);
    expect(() => evaluate("wall")).toThrow("No value called wall");
    expect(() => evaluate("4 / 0")).toThrow("Can't divide by zero");
    expect(() => evaluate("4 $ 2")).toThrow(ExprError);
  });
  it("tells a sum from a plain number", () => {
    expect(isExpression("12")).toBe(false);
    expect(isExpression("12 mm")).toBe(false);
    expect(isExpression("6*2")).toBe(true);
  });
});

describe("simple maths with parameters", () => {
  const scope = { width: 20, height: 10, depth: 4 };
  it("works out sums that use names", () => {
    expect(evaluate("width * 2", scope)).toBe(40);
    expect(evaluate("height / 2", scope)).toBe(5);
    expect(evaluate("depth + 3", scope)).toBe(7);
    expect(evaluate("(width - depth) / 2 + 1 mm", scope)).toBe(9);
    expect(evaluate("width + 1 cm", scope)).toBe(30);
  });
});

describe("completeAt", () => {
  const names = ["width", "wall", "height", "hole_d", "lid_height"];
  it("offers names that start with what is typed, then names that hold it", () => {
    expect(completeAt("w", 1, names)).toEqual({ from: 0, to: 1, typed: "w", names: ["wall", "width"] });
    expect(completeAt("2 * hei", 7, names)?.names).toEqual(["height", "lid_height"]);
    expect(completeAt("WI", 2, names)?.names).toEqual(["width"]);
  });
  it("finds the name at the caret, not at the end", () => {
    const c = completeAt("wi + 3", 2, names)!;
    expect(c).toMatchObject({ from: 0, to: 2, typed: "wi" });
    expect(applyCompletion("wi + 3", c, "width")).toEqual({ text: "width + 3", caret: 5 });
  });
  it("replaces the whole word under the caret", () => {
    const c = completeAt("widxx * 2", 3, names)!;
    expect(applyCompletion("widxx * 2", c, "width")).toEqual({ text: "width * 2", caret: 5 });
    const d = completeAt("hexx", 2, names)!;
    expect(applyCompletion("hexx", d, "height").text).toBe("height");
  });
  it("stays quiet for numbers, units, operators and a name already whole", () => {
    expect(completeAt("12", 2, names)).toBeNull();
    expect(completeAt("12 + ", 5, names)).toBeNull();
    expect(completeAt("5 mm", 4, ["mmm", "mm_x"])).toBeNull();
    expect(completeAt("5m", 2, ["mid"])).toBeNull();
    expect(completeAt("width", 5, names)).toBeNull();
    expect(completeAt("zz", 2, names)).toBeNull();
  });
  it("offers at most a handful", () => {
    const many = Array.from({ length: 20 }, (_, i) => `p${i}`);
    expect(completeAt("p", 1, many)?.names).toHaveLength(8);
  });
});
