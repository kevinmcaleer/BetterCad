import { addPart, changeParts, featureSummary, newDoc, nextViewName, parseDoc, partsOf, placePart, removeView, saveView } from "./document";
import { DEFAULT_CAMERA } from "../viewport/camera";

describe("document: turning and named views", () => {
  it("the gizmo's drop becomes one Move feature with position and turn", () => {
    let d = addPart(newDoc(), "box", "a");
    d = placePart(d, "a", { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 45 });
    expect(d.features).toHaveLength(2);
    const p = partsOf(d)[0]!;
    expect(p.position).toEqual({ x: 10, y: 0, z: 0 });
    expect(p.rotation).toEqual({ x: 0, y: 0, z: 45 });
    expect(featureSummary(d, d.features[1]!)).toContain("turn Z 45°");
    // Dropping it where it was adds nothing.
    expect(placePart(d, "a", { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 45 })).toBe(d);
  });

  it("the Rotation fields fold into the move before them", () => {
    let d = addPart(newDoc(), "box", "a");
    d = changeParts(d, ["a"], "position", { x: 5 });
    d = changeParts(d, ["a"], "rotation", { x: 90 });
    expect(d.features).toHaveLength(2);
    expect(partsOf(d)[0]!.rotation).toEqual({ x: 90, y: 0, z: 0 });
  });

  it("saves, updates, removes and reloads named views", () => {
    let d = saveView(newDoc(), { id: "v1", name: nextViewName(newDoc()), camera: DEFAULT_CAMERA });
    expect(d.views!.map((v) => v.name)).toEqual(["View 1"]);
    expect(nextViewName(d)).toBe("View 2");
    d = saveView(d, { id: "v1", name: "Bench", camera: { ...DEFAULT_CAMERA, distance: 50 } });
    expect(d.views).toHaveLength(1);
    expect(parseDoc(JSON.stringify(d)).views![0]!.camera.distance).toBe(50);
    expect(removeView(d, "v1").views).toEqual([]);
  });
});
