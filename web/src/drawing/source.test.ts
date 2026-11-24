import { describe, expect, it } from "vitest";
import type { DrawingRef } from "@bettercad/kernel/drawing";
import type { Feature } from "../state/document";
import { named, sizeSource } from "./source";

const ref = (name: string, body = "b1"): DrawingRef => ({ view: "v1", body, kind: "edge", index: 0, name });
const dimension = (id: string, name: string, kind: string, refs: string[], value: number, more: object = {}) => ({
  id,
  name,
  kind,
  refs,
  value,
  expression: String(value),
  driving: true,
  labelOffset: [0, 0],
  ...more,
});
/** A plate: a 60 by 40 rectangle with a Ø6 hole in it, pushed up 5 mm, then a second sketch cut through it. */
const features = [
  {
    id: "s1",
    type: "sketch",
    name: "Sketch 1",
    sketch: {
      entities: [
        { id: "p1", kind: "point" },
        { id: "p2", kind: "point" },
        { id: "p3", kind: "point" },
        { id: "pc", kind: "point" },
        { id: "l1", kind: "line", a: "p1", b: "p2" },
        { id: "l2", kind: "line", a: "p2", b: "p3" },
        { id: "c1", kind: "circle", c: "pc" },
      ],
      dimensions: [
        dimension("k1", "d1", "length", ["l1"], 60),
        dimension("k2", "d2", "distance", ["p2", "p3"], 40),
        dimension("k3", "d3", "diameter", ["c1"], 6),
        dimension("k4", "d4", "distanceX", ["pc", "l2"], 12),
        dimension("k5", "d5", "length", ["l2"], 40, { driving: false }),
      ],
    },
  },
  { id: "e1", type: "extrude", name: "Extrude 1", sketch: "s1", distance: 5, body: { id: "b1", name: "Plate" } },
  {
    id: "s2",
    type: "sketch",
    name: "Sketch 2",
    sketch: {
      entities: [
        { id: "q1", kind: "point" },
        { id: "q2", kind: "point" },
        { id: "l1", kind: "line", a: "q1", b: "q2" },
        { id: "a1", kind: "arc", c: "q1", start: "q2", end: "q1" },
      ],
      dimensions: [dimension("m1", "d6", "length", ["l1"], 20), dimension("m2", "d7", "radius", ["a1"], 4), dimension("m3", "d8", "angle", ["l1", "l1"], 30)],
    },
  },
  { id: "e2", type: "extrude", name: "Extrude 2", sketch: "s2", distance: -5, body: undefined },
  { id: "h1", type: "hole", name: "Hole 1", part: "b1" },
  { id: "bx", type: "add", name: "Box", part: "b9" },
] as unknown as Feature[];
const doc = { features };

describe("where the model sets a drawing's size", () => {
  it("reads sketch curves and steps out of an edge's name", () => {
    expect(named("cap.end|side(l1)")).toEqual({ curves: ["l1"], steps: [] });
    expect(named("e2:side(l1)#2|f9:e2:side(a1)")).toEqual({ curves: ["l1", "a1"], steps: ["e2", "f9", "e2"] });
    expect(named("f0|f5")).toEqual({ curves: [], steps: [] });
    expect(named(undefined)).toEqual({ curves: [], steps: [] });
  });

  it("finds the sketch dimension of an edge's length, a hole's diameter and a gap between two edges", () => {
    const edge = [ref("cap.end|side(l1)"), ref("cap.end|side(l1)")];
    expect(sizeSource(doc, { kind: "linear", refs: edge }, 60)).toEqual({ feature: "s1", dimension: "k1", label: "d1 in Sketch 1" });
    // A length given as the distance between the line's two ends.
    expect(sizeSource(doc, { kind: "linear", refs: [ref("cap.end|side(l2)")] }, 40)).toMatchObject({ dimension: "k2" });
    expect(sizeSource(doc, { kind: "diameter", refs: [ref("cap.end|side(c1)")] }, 6)).toMatchObject({ dimension: "k3", label: "d3 in Sketch 1" });
    expect(sizeSource(doc, { kind: "linear", refs: [ref("cap.end|side(c1)"), ref("cap.end|side(l2)")] }, 12)).toMatchObject({ dimension: "k4" });
  });

  it("matches a radius to a diameter and the other way round, and an angle to its other side", () => {
    expect(sizeSource(doc, { kind: "radius", refs: [ref("cap.start|side(c1)")] }, 3)).toMatchObject({ dimension: "k3" });
    expect(sizeSource(doc, { kind: "diameter", refs: [ref("cap.end|e2:side(a1)")] }, 8)).toMatchObject({ feature: "s2", dimension: "m2" });
    expect(sizeSource(doc, { kind: "angle", refs: [ref("e2:side(l1)|cap.end"), ref("e2:side(l1)|cap.end")] }, 150)).toMatchObject({ dimension: "m3" });
  });

  it("looks in the sketch of the step that made the edge first, when two sketches use the same curve name", () => {
    expect(sizeSource(doc, { kind: "linear", refs: [ref("cap.end|e2:side(l1)")] }, 20)).toMatchObject({ feature: "s2", dimension: "m1" });
    expect(sizeSource(doc, { kind: "linear", refs: [ref("cap.end|side(l1)")] }, 20)).toMatchObject({ feature: "s2", dimension: "m1" });
  });

  it("opens the Extrude for how far a shape was pushed, and the Hole for a hole's size", () => {
    const upright = [ref("side(l1)|side(l2)")];
    expect(sizeSource(doc, { kind: "linear", refs: upright }, 5)).toEqual({ feature: "e1", label: "Extrude 1" });
    // An edge on a cap that happens to be 5 mm long is not the push.
    expect(sizeSource(doc, { kind: "linear", refs: [ref("cap.end|side(l9)")] }, 5)).toBeUndefined();
    expect(sizeSource(doc, { kind: "diameter", refs: [ref("h1:f0|cap.end")] }, 3)).toEqual({ feature: "h1", label: "Hole 1" });
  });

  it("says nothing when no one thing sets the size", () => {
    // A size no sketch dimension has, a reference size, a primitive and an import with no names.
    expect(sizeSource(doc, { kind: "linear", refs: [ref("cap.end|side(l1)")] }, 61)).toBeUndefined();
    expect(sizeSource({ features: features.slice(0, 1) }, { kind: "linear", refs: [ref("cap.end|side(p1)")] }, 40)).toBeUndefined();
    expect(sizeSource(doc, { kind: "linear", refs: [ref("f0|f5", "b9"), ref("f2|f5", "b9")] }, 60)).toBeUndefined();
    expect(sizeSource(doc, { kind: "linear", refs: [{ view: "v1", body: "b7", kind: "edge", index: 3 }] }, 60)).toBeUndefined();
  });
});
