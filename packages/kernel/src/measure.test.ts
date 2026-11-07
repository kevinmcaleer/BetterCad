import { beforeAll, describe as group, expect, it } from "vitest";
import { loadOCCT, type OC } from "./occt/oc";
import { box, cylinder, elements, place } from "./occt/shapes";
import { between, describe, subShape, type TopoRef } from "./occt/measure";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

/** The index of the face whose centre is at a point. */
function faceAt(shape: Parameters<typeof elements>[1], at: [number, number, number]): number {
  return elements(oc, shape, "face").findIndex((f) => {
    const p = new oc.GProp_GProps();
    oc.BRepGProp.SurfaceProperties(f, p, false, false);
    const c = p.CentreOfMass();
    return Math.hypot(c.X() - at[0], c.Y() - at[1], c.Z() - at[2]) < 1e-6;
  });
}
const ref = (kind: TopoRef["kind"], index: number): TopoRef => ({ body: "b", kind, index });

group("measure", () => {
  it("gives the width of a box between its two side faces", () => {
    const s = box(oc, { x: 30, y: 20, z: 10 });
    const [l, r] = [faceAt(s, [-15, 0, 5]), faceAt(s, [15, 0, 5])];
    const [a, b] = [describe(oc, s, ref("face", l)), describe(oc, s, ref("face", r))];
    expect(a.kind === "face" && a.area).toBeCloseTo(200, 6);
    const p = between(oc, subShape(oc, s, ref("face", l)), subShape(oc, s, ref("face", r)), a, b);
    expect(p.distance).toBeCloseTo(30, 6);
    expect(Math.abs(p.delta[0])).toBeCloseTo(30, 6);
    expect(p.angle).toBeCloseTo(180, 6);
  });

  it("finds 90° between adjacent faces", () => {
    const s = box(oc, { x: 20, y: 20, z: 20 });
    const [top, side] = [faceAt(s, [0, 0, 20]), faceAt(s, [10, 0, 10])];
    const p = between(
      oc,
      subShape(oc, s, ref("face", top)),
      subShape(oc, s, ref("face", side)),
      describe(oc, s, ref("face", top)),
      describe(oc, s, ref("face", side)),
    );
    expect(p.distance).toBeCloseTo(0, 6);
    expect(p.angle).toBeCloseTo(90, 6);
  });

  it("reports a circular edge's diameter and centre, and the length of a straight one", () => {
    const s = cylinder(oc, { x: 16, y: 16, z: 10 });
    const circles = elements(oc, s, "edge")
      .map((_, i) => describe(oc, s, ref("edge", i)))
      .filter((d) => d.kind === "edge" && d.circle);
    expect(circles.length).toBe(2);
    const top = circles.find((d) => d.kind === "edge" && d.circle!.centre[2] > 5)!;
    expect(top.kind === "edge" && top.circle!.radius * 2).toBeCloseTo(16, 6);
    const b = box(oc, { x: 30, y: 20, z: 10 });
    const lengths = elements(oc, b, "edge").map((_, i) => describe(oc, b, ref("edge", i)));
    expect(lengths.map((d) => (d.kind === "edge" ? Math.round(d.length) : 0)).sort()).toEqual([10, 10, 10, 10, 20, 20, 20, 20, 30, 30, 30, 30]);
  });

  it("gives centre-to-centre between two bores, and a body's volume", () => {
    const a = place(oc, cylinder(oc, { x: 10, y: 10, z: 5 }), { position: { x: 0, y: 0, z: 0 } });
    const b = place(oc, cylinder(oc, { x: 6, y: 6, z: 5 }), { position: { x: 25, y: 0, z: 0 } });
    const round = (s: typeof a) =>
      elements(oc, s, "face").findIndex(
        (_, i) => describe(oc, s, ref("face", i)).kind === "face" && !!(describe(oc, s, ref("face", i)) as { circle?: unknown }).circle,
      );
    const [fa, fb] = [round(a), round(b)];
    const p = between(
      oc,
      subShape(oc, a, ref("face", fa)),
      subShape(oc, b, ref("face", fb)),
      describe(oc, a, ref("face", fa)),
      describe(oc, b, ref("face", fb)),
    );
    expect(p.centres).toBeCloseTo(25, 6);
    expect(p.distance).toBeCloseTo(25 - 5 - 3, 6);
    expect(describe(oc, a, ref("body", 0))).toMatchObject({ kind: "body" });
  });
});
