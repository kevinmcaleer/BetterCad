import { describe, expect, it } from "vitest";
import { BASICS, boardPads, emptyDesign, placePart, pushToBoard, type ElectronicsDesign } from "@bettercad/electronics";
import { addPour } from "@bettercad/electronics/pcb/pour";
import { addHole, addText, addTrack, addVia, setPlacement } from "@bettercad/electronics/pcb/route";
import { boxBoard, hitBoard, pickKindOf, type PickFilter } from "./hitBoard";

/** A resistor at (10, 20), a track, a via, a hole, some text and a pour, each in its own place. */
function board(): { d: ElectronicsDesign; part: string } {
  const a = placePart(emptyDesign(), "sh1", BASICS.resistor!(), { x: 0, y: 0 });
  let d = pushToBoard(a.design).design;
  d = setPlacement(d, a.part.id, { x: 10, y: 20 });
  d = addTrack(d, "", "top", [
    [30, 5],
    [40, 5],
  ]);
  d = addVia(d, "", 30, 30);
  d = addHole(d, 40, 30, 3);
  d = addText(d, 20, 35, "HI");
  d = addPour(d, "", "top", [
    [2, 2],
    [8, 2],
    [8, 8],
    [2, 8],
  ]);
  return { d, part: a.part.id };
}

const kinds = (d: ElectronicsDesign, f?: PickFilter) => {
  const ids = boxBoard(d, [0, 0], [50, 40], f);
  const b = d.board!;
  return {
    part: b.placements.some((p) => ids.includes(p.part)),
    track: ids.includes(b.tracks[0]!.id),
    via: ids.includes(b.vias[0]!.id),
    hole: ids.includes(b.holes[0]!.id),
    text: ids.includes(b.texts[0]!.id),
    pour: ids.includes(b.pours[0]!.id),
  };
};

describe("the board's selection filter (#748)", () => {
  it("sorts every kind of hit into one of the filter's kinds", () => {
    expect(["part", "pad", "track", "via", "area", "text", "picture", "hole", "mark"].map((k) => pickKindOf(k as never))).toEqual([
      "parts",
      "parts",
      "tracks",
      "vias",
      "pours",
      "text",
      "text",
      "holes",
      "holes",
    ]);
  });

  it("lets a drag box take everything, or only what is ticked", () => {
    const { d } = board();
    expect(kinds(d)).toEqual({ part: true, track: true, via: true, hole: true, text: true, pour: true });
    expect(kinds(d, { off: ["parts", "pours", "text"], skipLocked: false })).toEqual({
      part: false,
      track: true,
      via: true,
      hole: true,
      text: false,
      pour: false,
    });
    expect(kinds(d, { off: ["tracks", "vias", "holes"], skipLocked: false })).toEqual({
      part: true,
      track: false,
      via: false,
      hole: false,
      text: true,
      pour: true,
    });
  });

  it("lets a click reach what is under a thing left out", () => {
    let { d } = board();
    // A via on top of the track: with vias left out, the click takes the track.
    d = addVia(d, "", 35, 5);
    const pads = boardPads(d);
    expect(hitBoard(d, pads, [35, 5], 0.2)[0]!.kind).toBe("via");
    const hits = hitBoard(d, pads, [35, 5], 0.2, undefined, { off: ["vias"], skipLocked: false });
    expect(hits.map((h) => h.kind)).toEqual(["track"]);
  });

  it("leaves locked parts out when asked, pads and all", () => {
    const { d: start, part } = board();
    const d = setPlacement(start, part, { locked: true });
    const pads = boardPads(d);
    const at = pads[0]!.at;
    expect(hitBoard(d, pads, at, 0.2).some((h) => h.kind === "part" || h.kind === "pad")).toBe(true);
    expect(hitBoard(d, pads, at, 0.2, undefined, { off: [], skipLocked: true }).some((h) => h.kind === "part" || h.kind === "pad")).toBe(false);
    expect(kinds(d, { off: [], skipLocked: true }).part).toBe(false);
    expect(kinds(start, { off: [], skipLocked: true }).part).toBe(true);
  });
});
