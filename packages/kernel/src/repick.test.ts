import { beforeAll, describe, expect, it } from "vitest";
import { addFinish, addPart, build, changeParts, newDoc, type FinishFeature } from "./document";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";
import { reorderWithPicks } from "./occt/repick";
import { elements } from "./occt/shapes";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

describe("reordering re-picks edges and faces by place", () => {
  it("moves Shell before Fillet and keeps the open top and the rounded uprights", () => {
    const b = new ModelBuilder(oc);
    let d = addPart(newDoc(), "box", "t");
    d = changeParts(d, ["t"], "size", { x: 70, y: 58, z: 32 });
    const box = b.solid(build(d).parts[0]!).shape;
    const edges = elements(oc, box, "edge");
    const faces = elements(oc, box, "face");
    const props = (s: unknown, lin: boolean) => {
      const g = new oc.GProp_GProps();
      if (lin) oc.BRepGProp.LinearProperties(s as never, g, false, false);
      else oc.BRepGProp.SurfaceProperties(s as never, g, false, false);
      const c = g.CentreOfMass();
      const out = [c.X(), c.Y(), c.Z(), g.Mass()] as const;
      g.delete();
      return out;
    };
    // Upright edges are 32 mm long; the top face is the highest.
    const uprights = edges
      .map((e, i) => [i, props(e, true)] as const)
      .filter(([, p]) => Math.abs(p[3] - 32) < 1e-6)
      .map(([i]) => i);
    const top = faces.map((f, i) => [i, props(f, false)[2]] as const).sort((x, y) => y[1] - x[1])[0]![0];
    expect(uprights).toHaveLength(4);

    d = addFinish(d, { type: "fillet", part: "t", refs: uprights, size: 5 }, "f");
    // The shell's face is numbered on the filleted box, as the shell tool would pick it.
    const filleted = b.solid(build(d).parts[0]!).shape;
    const topAfter = elements(oc, filleted, "face")
      .map((f, i) => [i, props(f, false)[2]] as const)
      .sort((x, y) => y[1] - x[1])[0]![0];
    d = addFinish(d, { type: "shell", part: "t", refs: [topAfter], size: 2 }, "s");
    const before = b.build(d);
    expect(before.failed).toEqual([]);

    const moved = reorderWithPicks(oc, b, d, "s", "f");
    expect(moved.lost).toEqual([]);
    expect(moved.doc.features.map((f) => f.id)).toEqual([d.features[0]!.id, d.features[1]!.id, "s", "f"]);
    const shell = moved.doc.features.find((f) => f.id === "s") as FinishFeature;
    expect(shell.refs).toEqual([top]);
    const after = b.build(moved.doc);
    expect(after.failed).toEqual([]);
    // The same open tray, within 2%: only the inside corners differ (sharp now, since the fillet comes after the shell).
    const [v0, v1] = [before.bodies[0]!.measure.volume, after.bodies[0]!.measure.volume];
    expect(Math.abs(v1 - v0) / v0).toBeLessThan(0.02);
    expect(v1).toBeLessThan((70 * 58 * 32) / 2);

    // And back again: the same picks as at the start.
    const back = reorderWithPicks(oc, b, moved.doc, "f", "s");
    expect(back.lost).toEqual([]);
    expect((back.doc.features.find((f) => f.id === "f") as FinishFeature).refs.sort()).toEqual([...uprights].sort());
    expect((back.doc.features.find((f) => f.id === "s") as FinishFeature).refs).toEqual([topAfter]);
  });

  it("lists a step whose picks are gone", () => {
    const b = new ModelBuilder(oc);
    let d = addPart(newDoc(), "box", "t");
    // Round all 12 edges, then bevel one of the new rounded faces' edges: before the fillet that edge doesn't exist.
    d = addFinish(d, { type: "fillet", part: "t", refs: [...Array(12).keys()], size: 2 }, "f");
    d = addFinish(d, { type: "chamfer", part: "t", refs: [30], size: 0.5 }, "c");
    const moved = reorderWithPicks(oc, b, d, "c", "f");
    expect(moved.lost).toEqual(["Chamfer 1"]);
  });
});
