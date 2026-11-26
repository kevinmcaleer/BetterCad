import { describe, expect, it } from "vitest";
import { BASICS, boardPads, emptyDesign, placePart, pushToBoard } from "@bettercad/electronics";
import { addHole, addTrack, setPlacement } from "@bettercad/electronics/pcb/route";
import { measureSnap, measureText } from "./measure";

function board() {
  const a = placePart(emptyDesign(), "sh1", BASICS.resistor!(), { x: 0, y: 0 });
  let d = setPlacement(pushToBoard(a.design).design, a.part.id, { x: 10, y: 20 });
  d = addHole(d, 30, 30, 3.2);
  d = addTrack(d, "", "top", [
    [5, 5],
    [15, 5],
  ]);
  return d;
}

describe("measure on the board (#732)", () => {
  it("snaps to a pad's centre, a hole's centre and a track's end", () => {
    const d = board();
    const pads = boardPads(d);
    const pad = pads[0]!;
    expect(measureSnap(d, pads, [pad.at[0] + 0.2, pad.at[1] - 0.1], 0.5, 0.5)).toEqual({ at: pad.at, on: "pad" });
    expect(measureSnap(d, pads, [30.3, 29.8], 0.5, 0.5)).toEqual({ at: [30, 30], on: "hole" });
    expect(measureSnap(d, pads, [15.2, 5.1], 0.5, 0.5)).toEqual({ at: [15, 5], on: "track" });
  });

  it("snaps to the board's edge, else to the grid", () => {
    const d = board();
    const pads = boardPads(d);
    expect(measureSnap(d, pads, [0.3, 12.2], 0.5, 0.5)).toEqual({ at: [0, 12.2], on: "edge" });
    expect(measureSnap(d, pads, [22.2, 12.6], 0.5, 0.5)).toEqual({ at: [22, 12.5], on: "grid" });
  });

  it("reads out the distance, and dx and dy, in mm", () => {
    expect(measureText([0, 0], [3, 4])).toBe("5 mm · dx 3 mm · dy 4 mm");
    expect(measureText([10, 2], [2.5, 2])).toBe("7.5 mm · dx 7.5 mm · dy 0 mm");
  });
});
