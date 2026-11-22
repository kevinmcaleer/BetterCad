import { assemblyLinks, assemblyRoot, underFloor } from "./floor";

const joints = [
  { child: "bottom", parent: "top" },
  { child: "foot", parent: "bottom" },
  { child: "arm", parent: null },
];

describe("an assembly under the floor", () => {
  it("finds the component at the top of a joint chain", () => {
    expect(assemblyRoot(joints, "foot")).toBe("top");
    expect(assemblyRoot(joints, "top")).toBe("top");
    expect(assemblyRoot(joints, "arm")).toBeNull();
    expect(
      assemblyRoot(
        [
          { child: "a", parent: "b" },
          { child: "b", parent: "a" },
        ],
        "a",
      ),
    ).toBe("a");
  });

  it("gathers a component, what hangs from it, and the components nested in those", () => {
    const links = [
      { id: "top", name: "top", parts: [] },
      { id: "screw", name: "screw", parts: [], parent: "foot" },
    ];
    expect([...assemblyLinks(joints, links, "top")].sort()).toEqual(["bottom", "foot", "screw", "top"]);
  });

  it("says how far the lowest part goes under the floor, letting an STL's rounding pass", () => {
    expect(underFloor([{ min: [0, 0, 0] }, { min: [8, -54, -68.575] }, null])).toBeCloseTo(68.575);
    expect(underFloor([{ min: [0, 0, -0.01] }])).toBe(0);
    expect(underFloor([])).toBe(0);
  });
});
