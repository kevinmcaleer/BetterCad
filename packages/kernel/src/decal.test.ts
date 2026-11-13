import { describe, expect, it } from "vitest";
import { addDecal, addPart, build, changeParts, dependsOn, featureSummary, newDoc, removeParts, updateDecal, type DecalParams } from "./document";
import { BcadError, loadBcad, saveBcad } from "./bcad";

const box = () => addPart(newDoc(), "box", "a");
const logo: DecalParams = {
  part: "a",
  face: 5,
  faceName: "f5",
  image: { blob: "h1", type: "image/png", file: "logo.png", width: 200, height: 100 },
  x: 0,
  y: 0,
  width: 40,
  height: 20,
  angle: 0,
};

describe("decals (#263)", () => {
  it("puts a picture on a body's face, keeping its bytes once", () => {
    let doc = addDecal(box(), logo, "AAAA", "d1");
    doc = addDecal(doc, { ...logo, x: 5 }, "AAAA", "d2");
    expect(Object.keys(doc.blobs!)).toEqual(["h1"]);
    const b = build(doc);
    expect(b.failed.size).toBe(0);
    expect(b.decals?.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(doc.features.at(-1)).toMatchObject({ type: "decal", name: "Decal 2" });
    expect(featureSummary(doc, doc.features[1]!)).toBe("logo.png, 40 × 20 mm on Box 1");
    // Its body's maker comes before it, and so does every step that renumbers the body's faces.
    expect(dependsOn(doc, "d1")).toEqual([doc.features[0]!.id]);
  });

  it("moves, sizes and turns, and takes a new picture", () => {
    let doc = addDecal(box(), logo, "AAAA", "d1");
    doc = updateDecal(doc, "d1", { x: 3, angle: 90, flip: true });
    expect(build(doc).decals![0]).toMatchObject({ x: 3, angle: 90, flip: true, width: 40 });
    doc = updateDecal(doc, "d1", { image: { ...logo.image, blob: "h2", file: "new.png" } }, "BBBB");
    expect(doc.blobs).toEqual({ h1: "AAAA", h2: "BBBB" });
  });

  it("goes with its body, and fails plainly when the body or the picture is gone", () => {
    let doc = addDecal(box(), logo, "AAAA", "d1");
    doc = changeParts(doc, ["a"], "position", { x: 10 });
    expect(build(doc).decals).toHaveLength(1);
    expect(build(removeParts(doc, ["a"])).decals).toEqual([]);
    const early = { ...doc, features: [doc.features[1]!, doc.features[0]!, doc.features[2]!] };
    expect(build(early).failed.get("d1")).toBe("The body it sits on is gone");
    expect(build({ ...doc, blobs: {} }).failed.get("d1")).toBe("Its picture is missing from the model");
  });

  it("round-trips through .bcad with its picture", () => {
    const doc = addDecal(box(), logo, "AAAA", "d1");
    const back = loadBcad(saveBcad(doc));
    if (back instanceof BcadError) throw back;
    expect(back.warning).toBeUndefined();
    expect(build(back.doc).decals![0]).toMatchObject({ id: "d1", image: logo.image });
    expect(back.doc.blobs).toEqual({ h1: "AAAA" });
  });
});
