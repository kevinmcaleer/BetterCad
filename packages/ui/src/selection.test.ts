import { clickSelect } from "./selection";

const ORDER = ["a", "b", "c", "d"];

describe("clickSelect", () => {
  it("selects only the clicked item", () => {
    expect(clickSelect(ORDER, ["a", "b"], "a", "c")).toEqual({ selection: ["c"], anchor: "c" });
  });
  it("adds and removes with Ctrl", () => {
    expect(clickSelect(ORDER, ["a"], "a", "c", { toggle: true }).selection).toEqual(["a", "c"]);
    expect(clickSelect(ORDER, ["a", "c"], "a", "c", { toggle: true }).selection).toEqual(["a"]);
  });
  it("selects a range with Shift, either way round", () => {
    expect(clickSelect(ORDER, ["b"], "b", "d", { shift: true }).selection).toEqual(["b", "c", "d"]);
    expect(clickSelect(ORDER, ["c"], "c", "a", { shift: true })).toEqual({ selection: ["a", "b", "c"], anchor: "c" });
  });
  it("treats Shift with no anchor as a plain click", () => {
    expect(clickSelect(ORDER, [], null, "b", { shift: true }).selection).toEqual(["b"]);
  });
});
