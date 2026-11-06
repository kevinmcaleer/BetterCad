import { evaluate, isExpression, ExprError } from "./expr";

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
