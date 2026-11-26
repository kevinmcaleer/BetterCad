import { describe, expect, it } from "vitest";
import { sampleBoard } from "@bettercad/electronics/sample";
import { addKeepoutArea } from "@bettercad/electronics/pcb/pour";
import { addTrack } from "@bettercad/electronics/pcb/route";
import { handleAt, handlesOf } from "./hitBoard";

describe("corners to drag on the board (#742)", () => {
  it("shows a track's bends, not its ends, and finds one under the pointer", () => {
    const d = addTrack(sampleBoard(), "GND", "top", [
      [1, 1],
      [6, 1],
      [6, 6],
    ]);
    const t = d.board!.tracks.at(-1)!;
    expect(handlesOf(d.board!, t.id)).toMatchObject({ kind: "track", handles: [1] });
    expect(handleAt(d.board!, t.id, [6.1, 1.1], 0.3)).toEqual({ i: 1 });
    expect(handleAt(d.board!, t.id, [1, 1], 0.3)).toBeNull();
  });

  it("shows an area's corners, and a place on its edge for a new one", () => {
    const d = addKeepoutArea(sampleBoard(), [
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    const k = d.board!.keepouts.at(-1)!;
    expect(handlesOf(d.board!, k.id)!.handles).toEqual([0, 1, 2]);
    expect(handleAt(d.board!, k.id, [10, 0.1], 0.3)).toEqual({ i: 1 });
    expect(handleAt(d.board!, k.id, [5, 0.1], 0.3)).toEqual({ edge: 0, at: [5, 0.1] });
    expect(handleAt(d.board!, k.id, [5, 5.5], 0.3)).toBeNull();
  });
});
