import { describe, expect, it } from "vitest";
import { addJoint, addLink, addPart, newDoc } from "../state/document";
import { assembly, partName } from "./exportSteps";

describe("the assembly sent with the parts", () => {
  it("names each part from its file, without the model's name", () => {
    expect(partName("Rover-Wheel 1.stl", "Rover")).toBe("Wheel 1");
    expect(partName("Rover.stl", "Rover")).toBe("Rover");
    expect(partName("Other.stl", "Rover")).toBe("Other");
  });

  it("carries each part's component and the joints between them", () => {
    let d = addPart(newDoc("Arm"), "box", "base");
    d = addPart(d, "box", "arm");
    d = addLink(d, ["arm"], "l1", undefined, undefined, "Upper arm");
    d = addJoint(d, { kind: "revolute", child: "l1", parent: null, origin: [10, 0, 20], axis: [0, 1, 0], lower: -45, upper: 90 }, "j1");
    const a = assembly(d, d.features.length, [
      { id: "base", name: "Box 1", file: "models/Arm-Box 1.stl", position: [0, 0, 10] },
      { id: "arm", name: "Box 2", file: "models/Arm-Box 2.stl", position: [25, 0, 10] },
    ]);
    expect(a).toMatchObject({ generator: "BetterCad", version: 1, units: "mm" });
    expect(a.parts.map((p) => ("link" in p ? p.link : null))).toEqual([null, "l1"]);
    expect(a.links).toEqual([{ id: "l1", name: "Upper arm" }]);
    expect(a.joints).toEqual([
      { id: "j1", name: expect.any(String), kind: "revolute", child: "l1", parent: null, origin: [10, 0, 20], axis: [0, 1, 0], lower: -45, upper: 90 },
    ]);
  });
});
