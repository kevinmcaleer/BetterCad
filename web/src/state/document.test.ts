import {
  addPart,
  build,
  changeParts,
  duplicatePart,
  duplicateParts,
  featureSummary,
  newDoc,
  nextName,
  parseDoc,
  partsOf,
  removeFeature,
  removePart,
  removeParts,
  reorderFeature,
  reorderPart,
  setLook,
  updateFeature,
} from "./document";

const ids = (d: Parameters<typeof partsOf>[0], upTo?: number) => partsOf(d, upTo).map((p) => p.id);

describe("document", () => {
  it("names parts by kind", () => {
    let d = newDoc();
    d = addPart(d, "box", "a");
    d = addPart(d, "box", "b");
    expect(partsOf(d).map((p) => p.name)).toEqual(["Box 1", "Box 2"]);
    expect(nextName(d, "cylinder")).toBe("Cylinder 1");
  });
  it("keeps names unique even after a part is deleted", () => {
    const d = removePart(addPart(newDoc(), "box", "a"), "a");
    expect(nextName(d, "box")).toBe("Box 2");
  });
  it("renames, duplicates and removes without mutating", () => {
    const d0 = addPart(newDoc(), "box", "a");
    const d1 = setLook(d0, ["a"], () => ({ name: "Lid" }));
    expect(partsOf(d0)[0]!.name).toBe("Box 1");
    const d2 = duplicatePart(d1, "a", "b");
    expect(partsOf(d2).map((p) => p.name)).toEqual(["Lid", "Lid copy"]);
    expect(ids(removePart(d2, "a"))).toEqual(["b"]);
    expect(ids(d2)).toEqual(["a", "b"]);
  });
  it("round-trips through JSON and rejects other files", () => {
    const d = changeParts(addPart(newDoc("Bracket"), "sphere", "a"), ["a"], "position", { z: 5 });
    expect(parseDoc(JSON.stringify(d))).toEqual(d);
    expect(() => parseDoc("{}")).toThrow("not a BetterCad model");
    expect(() => parseDoc("nope")).toThrow("not a BetterCad model");
  });
  it("opens an epic #2 file as one Add step per part", () => {
    const v1 = {
      format: "bettercad",
      version: 1,
      name: "Old",
      parts: [{ id: "a", name: "Lid", kind: "box", hidden: true, position: { x: 1, y: 2, z: 3 }, size: { x: 4, y: 5, z: 6 } }],
    };
    const d = parseDoc(JSON.stringify(v1));
    expect(d.version).toBe(2);
    expect(d.features.map((f) => f.type)).toEqual(["add"]);
    expect(partsOf(d)[0]).toMatchObject({ id: "a", name: "Lid", hidden: true, position: { x: 1, y: 2, z: 3 }, size: { x: 4, y: 5, z: 6 } });
  });
});

describe("document: several parts", () => {
  it("reorders, changes and removes several parts", () => {
    let d = addPart(addPart(addPart(newDoc(), "box", "a"), "box", "b"), "box", "c");
    d = reorderPart(d, "c", "a");
    expect(ids(d)).toEqual(["c", "a", "b"]);
    d = reorderPart(d, "c", null);
    expect(ids(d)).toEqual(["a", "b", "c"]);
    d = changeParts(d, ["a", "c"], "size", { x: 5 });
    expect(partsOf(d).map((p) => p.size.x)).toEqual([5, 20, 5]);
    expect(ids(removeParts(d, ["a", "b"]))).toEqual(["c"]);
  });
  it("duplicates several parts as one step", () => {
    const d = duplicateParts(addPart(addPart(newDoc(), "box", "a"), "box", "b"), ["a", "b"], ["a2", "b2"]);
    expect(d.features.map((f) => f.name)).toEqual(["Box 1", "Box 2", "Duplicate 1"]);
    expect(ids(d)).toEqual(["a", "a2", "b", "b2"]);
  });
});

describe("timeline", () => {
  const three = () => changeParts(addPart(addPart(newDoc(), "box", "a"), "cylinder", "b"), ["a"], "position", { x: 40 });

  it("records each modelling action as a step", () => {
    const d = removePart(three(), "b");
    expect(d.features.map((f) => `${f.type}:${f.name}`)).toEqual(["add:Box 1", "add:Cylinder 1", "move:Move 1", "delete:Delete 1"]);
  });
  it("maps the marker position to the number of built steps", () => {
    const d = three();
    expect(ids(d, 0)).toEqual([]);
    expect(ids(d, 1)).toEqual(["a"]);
    expect(ids(d, 2)).toEqual(["a", "b"]);
    expect(partsOf(d, 2)[0]!.position.x).toBe(0);
    expect(partsOf(d, 3)[0]!.position.x).toBe(40);
  });
  it("inserts a new step at the marker when rolled back", () => {
    const d = addPart(three(), "sphere", "s", 1);
    expect(d.features.map((f) => f.name)).toEqual(["Box 1", "Sphere 1", "Cylinder 1", "Move 1"]);
    expect(ids(d, 2)).toEqual(["a", "s"]);
    // It is placed from the parts built at the marker, not the whole model.
    expect(partsOf(d, 2)[1]!.position.x).toBe(25);
  });
  it("folds a run of edits to the same parts into one step", () => {
    let d = three();
    d = changeParts(d, ["a"], "position", { y: 7 });
    d = changeParts(d, ["a"], "position", { x: 41 });
    expect(d.features.filter((f) => f.type === "move")).toHaveLength(1);
    expect(featureSummary(d, d.features[2]!)).toBe("Box 1, X 41 mm, Y 7 mm");
    d = changeParts(d, ["b"], "position", { x: 1 });
    expect(d.features.filter((f) => f.type === "move")).toHaveLength(2);
  });
  it("skips suppressed steps and flags steps whose parts are gone", () => {
    let d = three();
    const add = d.features[0]!;
    d = updateFeature(d, add.id, { suppressed: true });
    const b = build(d);
    expect(b.parts.map((p) => p.id)).toEqual(["b"]);
    expect(b.failed.get(d.features[2]!.id)).toBe("The parts it changes are gone");
    d = removeFeature(updateFeature(d, add.id, { suppressed: false }), d.features[2]!.id);
    expect(partsOf(d)[0]!.position.x).toBe(0);
    expect(build(d).failed.size).toBe(0);
  });
  it("reorders steps", () => {
    const d = three();
    const moved = reorderFeature(d, d.features[2]!.id, d.features[0]!.id);
    expect(moved.features.map((f) => f.name)).toEqual(["Move 1", "Box 1", "Cylinder 1"]);
    expect(build(moved).failed.has(d.features[2]!.id)).toBe(true);
  });
  it("summarises steps for tooltips", () => {
    const d = three();
    expect(featureSummary(d, d.features[1]!)).toBe("Cylinder, 20 × 20 × 30 mm");
  });
});
