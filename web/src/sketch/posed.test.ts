import { describe, expect, it } from "vitest";
import { planeFrame, type PlaneRef } from "@bettercad/sketch";
import { placeMatrix } from "../state/document";
import { homePlane, posedFrame } from "./useSketch";

const round = (v: number[]) => v.map((x) => Math.round(x * 1e6) / 1e6 + 0);

describe("sketching on a posed model", () => {
  // A component turned 90° about Z: what was along +X is along +Y.
  const turn = placeMatrix([0, 0, 0], [0, 0, 90]);
  const face: PlaneRef = { kind: "face", face: { body: "b", face: 1 }, offset: 0, frame: { origin: [0, 30, 10], x: [0, 1, 0], normal: [0, 0, 1] } };

  it("keeps a face picked on a turned body where the body is at home", () => {
    const kept = homePlane(face, turn);
    const f = planeFrame(kept);
    expect(round(f.origin)).toEqual([30, 0, 10]);
    expect(round(f.x)).toEqual([1, 0, 0]);
    // And shown posed, it is back where it was picked.
    const shown = posedFrame("s", kept, [], [], new Map([["s", turn]]));
    expect(round(shown.origin)).toEqual([0, 30, 10]);
    expect(round(shown.x)).toEqual([0, 1, 0]);
  });

  it("leaves a face on a body at home, and other planes, as they are", () => {
    expect(homePlane(face, undefined)).toBe(face);
    const world: PlaneRef = { kind: "world", plane: "XY", offset: 0 };
    expect(homePlane(world, turn)).toBe(world);
  });
});
