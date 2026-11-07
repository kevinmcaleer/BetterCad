import { beforeAll, describe, expect, it } from "vitest";
import { cataloguePart, placeOnFace } from "./catalogue";
import { addPart, build, changeParts, cutPocket, insertCatalogue, newDoc, type ExtrudeFeature, type HoleFeature, type ModelDoc } from "./document";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

/** A plate `t` thick with a part standing on its top, turned `quarters`. */
function plateWith(id: string, t = 5, quarters = 0, w = 60, d = 40): ModelDoc {
  let doc = addPart(newDoc(), "box", "plate");
  doc = changeParts(doc, ["plate"], "size", { x: w, y: d, z: t });
  return insertCatalogue(doc, cataloguePart(id)!, placeOnFace([0, 0, t], [0, 0, 1], [1, 0, 0], quarters), "part");
}

const volume = (doc: ModelDoc) => {
  const r = new ModelBuilder(oc).build(doc);
  expect(r.failed).toEqual([]);
  return r.bodies.find((b) => b.id === "plate")!.measure;
};

describe("Cut pocket (#188)", () => {
  it("makes a sketch, an extrude cut with a sliding fit, and a Hole step for each screw size", () => {
    const { doc, error } = cutPocket(plateWith("sg90"), "part", { target: "plate" });
    expect(error).toBeUndefined();
    const added = doc.features.slice(doc.features.findIndex((f) => f.type === "insert") + 1);
    expect(added.map((f) => f.type)).toEqual(["sketch", "extrude", "hole"]);
    expect(added[0]!.name).toBe("SG90 micro servo pocket");
    expect(added[1]).toMatchObject({ operation: "cut", target: "plate", distance: -15.9, fit: "sliding", gap: 0.25 } satisfies Partial<ExtrudeFeature>);
    expect(added[2]).toMatchObject({
      part: "plate",
      size: "M2",
      fit: "printed",
      depth: null,
      points: [
        [-13.9, 0],
        [13.9, 0],
      ],
    } satisfies Partial<HoleFeature>);
    expect(build(doc).failed.size).toBe(0);
  });

  it("cuts an SG90 pocket through a 5 mm plate, with its M2 holes", () => {
    const { doc } = cutPocket(plateWith("sg90"), "part", { target: "plate" });
    const m = volume(doc);
    const hole = Math.PI * 1.2 ** 2 * 5; // M2 printed: 2.4 mm
    const pocket = 22.7 * 12.3 * 5; // 22.2 × 11.8 grown 0.25 mm a side
    expect(m.volume).toBeCloseTo(60 * 40 * 5 - pocket - 2 * hole, 0);
  });

  it("follows the part's turn", () => {
    const flat = cutPocket(plateWith("sg90"), "part", { target: "plate", fit: null }).doc;
    const turned = cutPocket(plateWith("sg90", 5, 1), "part", { target: "plate", fit: null }).doc;
    const a = volume(flat);
    const b = volume(turned);
    expect(b.volume).toBeCloseTo(a.volume, 3);
    const hole = turned.features.find((f): f is HoleFeature => f.type === "hole")!;
    // The holes are along the part's x, now the world's y.
    expect(hole.frame.x[1]).toBeCloseTo(1, 9);
  });

  it("cuts a Pi Pico's four M2 holes and no pocket", () => {
    const { doc } = cutPocket(plateWith("pico"), "part", { target: "plate" });
    expect(doc.features.slice(doc.features.findIndex((f) => f.type === "insert") + 1).map((f) => f.type)).toEqual(["hole"]);
    const m = volume(doc);
    expect(m.volume).toBeCloseTo(60 * 40 * 5 - 4 * Math.PI * 1.2 ** 2 * 5, 1);
    expect(m.faces).toBe(6 + 4);
  });

  it("makes heat-set insert holes as deep as the insert", () => {
    const { doc } = cutPocket(plateWith("pico"), "part", { target: "plate", holes: "insert" });
    const h = doc.features.find((f): f is HoleFeature => f.type === "hole")!;
    expect(h).toMatchObject({ fit: "insert", depth: 4 });
  });

  it("says why when there's nothing to cut, or no part", () => {
    expect(cutPocket(plateWith("tt-motor"), "part", { target: "plate" }).error).toMatch(/no pocket or screw holes/);
    expect(cutPocket(plateWith("sg90"), "plate", { target: "plate" }).error).toMatch(/catalogue/);
    expect(cutPocket(plateWith("sg90"), "part", { target: "part" }).error).toMatch(/sits on/);
  });
});
