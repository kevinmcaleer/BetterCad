import { addPart, duplicatePart, newDoc, nextName, parseDoc, removePart, removeParts, reorderPart, updatePart, updateParts } from "./document";

describe("document", () => {
  it("names parts by kind", () => {
    let d = newDoc();
    d = addPart(d, "box", "a");
    d = addPart(d, "box", "b");
    expect(d.parts.map((p) => p.name)).toEqual(["Box 1", "Box 2"]);
    expect(nextName(d, "cylinder")).toBe("Cylinder 1");
  });
  it("updates, duplicates and removes without mutating", () => {
    const d0 = addPart(newDoc(), "box", "a");
    const d1 = updatePart(d0, "a", { name: "Lid" });
    expect(d0.parts[0]!.name).toBe("Box 1");
    const d2 = duplicatePart(d1, "a", "b");
    expect(d2.parts.map((p) => p.name)).toEqual(["Lid", "Lid copy"]);
    expect(removePart(d2, "a").parts.map((p) => p.id)).toEqual(["b"]);
  });
  it("round-trips through JSON and rejects other files", () => {
    const d = addPart(newDoc("Bracket"), "sphere", "a");
    expect(parseDoc(JSON.stringify(d))).toEqual(d);
    expect(() => parseDoc("{}")).toThrow("not a BetterCad model");
    expect(() => parseDoc("nope")).toThrow("not a BetterCad model");
  });
});

describe("document: several parts", () => {
  it("reorders, updates and removes several parts", () => {
    let d = addPart(addPart(addPart(newDoc(), "box", "a"), "box", "b"), "box", "c");
    d = reorderPart(d, "c", "a");
    expect(d.parts.map((p) => p.id)).toEqual(["c", "a", "b"]);
    d = reorderPart(d, "c", null);
    expect(d.parts.map((p) => p.id)).toEqual(["a", "b", "c"]);
    d = updateParts(d, ["a", "c"], (p) => ({ size: { ...p.size, x: 5 } }));
    expect(d.parts.map((p) => p.size.x)).toEqual([5, 20, 5]);
    expect(removeParts(d, ["a", "b"]).parts.map((p) => p.id)).toEqual(["c"]);
  });
});
