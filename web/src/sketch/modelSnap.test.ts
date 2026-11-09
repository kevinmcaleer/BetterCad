import { describe, expect, it } from "vitest";
import { newSketch, type Frame, type Vec3 } from "@bettercad/sketch";
import { modelTargets, resolveModelSnaps, type ModelSource } from "./modelSnap";
import { snap, type Snap } from "./snap";
import { commit } from "./tools";

/** The XY plane, lifted 5 mm: a sketch on top of a 5 mm plate. */
const TOP: Frame = { origin: [0, 0, 5], x: [1, 0, 0], normal: [0, 0, 1] };

/** A ring of points round (cx, cy) at height z. */
const ring = (cx: number, cy: number, r: number, z: number, n = 32): Vec3[] =>
  Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n), z]);

/** A plate with a hole: a hole's rim on the bottom face, one straight edge and a corner on top. */
const plate: ModelSource = {
  bodyCounts: () => [{ id: "plate", edges: 3, vertices: 1 }],
  edgePoints: (_b, e) =>
    e === 0
      ? ring(30, 20, 4, 0)
      : e === 1
        ? [
            [0, 0, 5],
            [60, 0, 5],
          ]
        : // An edge square to the plane flattens to a point and offers nothing.
          [
            [60, 40, 0],
            [60, 40, 5],
          ],
  vertexPoint: () => [60, 40, 5],
};

describe("snapping to the model", () => {
  const targets = modelTargets(plate, TOP);

  it("offers the model's corners, the centres of its holes and the middles of its straight edges", () => {
    expect(targets.map((t) => t.kind).sort()).toEqual(["centre", "end", "middle"]);
    const centre = targets.find((t) => t.kind === "centre")!;
    expect(centre.xy[0]).toBeCloseTo(30);
    expect(centre.xy[1]).toBeCloseTo(20);
    expect(targets.find((t) => t.kind === "middle")!.xy).toEqual([30, 0]);
  });

  it("snaps to a hole's centre that isn't in the sketch yet", () => {
    const s = snap([30.4, 19.7], newSketch(), { px: 0.1, grid: 1, model: targets });
    expect(s).toMatchObject({ kind: "centre", label: "Centre" });
    expect(s.model?.from).toEqual({ body: "plate", edge: 0 });
  });

  it("lets a point already in the sketch win a tie with the model", () => {
    const sk = commit("point", newSketch(), [{ xy: [60, 40], kind: "free", label: "" }])!.sketch;
    const s = snap([60.2, 40.1], sk, { px: 0.1, grid: null, model: targets });
    expect(s.kind).toBe("end");
    expect(s.model).toBeUndefined();
    expect(s.ref).toBeDefined();
  });

  it("projects the hole when a line starts on its centre, in one sketch", () => {
    const start = snap([30.2, 20.1], newSketch(), { px: 0.1, grid: null, model: targets });
    const end: Snap = { xy: [50, 20], kind: "free", label: "" };
    const { sketch, clicks } = resolveModelSnaps(newSketch(), TOP, [start, end]);
    const circle = sketch.entities.find((e) => e.kind === "circle");
    expect(circle?.projectedFrom).toEqual({ body: "plate", edge: 0 });
    expect(clicks[0]).toMatchObject({ kind: "centre", ref: circle!.kind === "circle" ? circle!.c : "" });
    expect(clicks[0]!.model).toBeUndefined();
    const line = commit("line", sketch, clicks)!;
    const drawn = line.sketch.entities.find((e) => e.kind === "line" && !e.projectedFrom);
    expect(drawn?.kind === "line" && drawn.a).toBe(circle!.kind === "circle" ? circle!.c : "");
  });

  it("ties a click on a straight edge's middle to the projected edge", () => {
    const m = snap([30.2, 0.2], newSketch(), { px: 0.1, grid: null, model: targets });
    expect(m.kind).toBe("middle");
    const { sketch, clicks } = resolveModelSnaps(newSketch(), TOP, [m]);
    const edge = sketch.entities.find((e) => e.kind === "line");
    expect(clicks[0]).toMatchObject({ kind: "middle", ref: edge!.id });
  });
});
