import { describe, expect, it } from "vitest";
import type { FootprintDef } from "@bettercad/electronics";
import {
  addOutline,
  addPad,
  deleteItems,
  hitFootprint,
  itemBox,
  landBox,
  moveItems,
  nextPadNumber,
  padsOf,
  setOutline,
  setPadKind,
  setPads,
  shared,
  wrapCourtyard,
} from "./footprintEdit";

const empty = (): FootprintDef => ({ name: "Land", pads: [], shapes: [] });

/** Two surface pads 2 mm apart with a fabrication outline round them. */
function pair(): FootprintDef {
  let fp = addPad(empty(), [-1, 0]).fp;
  fp = addPad(fp, [1, 0]).fp;
  return addOutline(fp, { kind: "rect", x1: -0.8, y1: -0.4, x2: 0.8, y2: 0.4 }, "fab").fp;
}

describe("editing a footprint pad by pad", () => {
  it("adds pads numbered on from the largest, each shaped like the last", () => {
    const first = addPad(empty(), [0, 0]);
    expect(first.id).toBe("p0");
    expect(first.fp.pads[0]).toEqual({ number: "1", kind: "smd", shape: "roundrect", round: 0.25, x: 0, y: 0, w: 1, h: 0.6 });
    const wide = setPads(first.fp, ["p0"], { w: 2, number: "7" });
    const second = addPad(wide, [3, 0]);
    expect(second.fp.pads[1]).toMatchObject({ number: "8", w: 2, x: 3 });
    expect(nextPadNumber({ ...empty(), pads: [{ ...first.fp.pads[0]!, number: "A1" }] })).toBe("1");
  });

  it("moves and deletes pads and outlines together", () => {
    const moved = moveItems(pair(), ["p0", "s0"], 0.5, -0.25);
    expect(moved.pads.map((p) => [p.x, p.y])).toEqual([
      [-0.5, -0.25],
      [1, 0],
    ]);
    expect(moved.shapes[0]).toMatchObject({ x1: -0.3, y1: -0.65, x2: 1.3, y2: 0.15 });
    expect(moveItems(pair(), [], 1, 1)).toEqual(pair());
    const gone = deleteItems(pair(), ["p1", "s0"]);
    expect(gone.pads.map((p) => p.number)).toEqual(["1"]);
    expect(gone.shapes).toEqual([]);
  });

  it("gives a pad its own mask and paste openings, and hands them back to the board's rule", () => {
    let fp = setPads(pair(), ["p0", "p1"], { maskMargin: 0.1 });
    expect(fp.pads.map((p) => p.maskMargin)).toEqual([0.1, 0.1]);
    fp = setPads(fp, ["p1"], { maskMargin: undefined, pasteMargin: -0.05 });
    expect(fp.pads[1]).not.toHaveProperty("maskMargin");
    expect(fp.pads[1]!.pasteMargin).toBe(-0.05);
    expect(shared(padsOf(fp, ["p0", "p1"]), "w", 0)).toBe(1);
    expect(shared(padsOf(fp, ["p0", "p1"]), "pasteMargin", 0)).toBeNull();
    fp = setPads(fp, ["p1"], { noPaste: true, pasteMargin: undefined });
    expect(fp.pads[1]).toMatchObject({ noPaste: true });
    expect(fp.pads[1]).not.toHaveProperty("pasteMargin");
  });

  it("changes a pad's kind and puts right what no longer fits", () => {
    const pasted = setPads(pair(), ["p0"], { pasteMargin: -0.05, noPaste: true });
    const thru = setPadKind(pasted, ["p0"], "thru");
    expect(thru.pads[0]).toMatchObject({ kind: "thru", drill: 0.36 });
    expect(thru.pads[0]).not.toHaveProperty("noPaste");
    expect(thru.pads[0]).not.toHaveProperty("pasteMargin");
    const bare = setPadKind(thru, ["p0"], "npth");
    expect(bare.pads[0]).toMatchObject({ kind: "npth", number: "", drill: 0.36 });
    const back = setPadKind(bare, ["p0"], "smd");
    expect(back.pads[0]).toMatchObject({ kind: "smd", number: "3" });
    expect(back.pads[0]).not.toHaveProperty("drill");
    expect(setPadKind(pair(), ["p0"], "smd")).toEqual(pair());
  });

  it("finds pads before the outlines under them, and boxes what is picked", () => {
    const fp = pair();
    expect(hitFootprint(fp, [-0.7, 0.35], 0.1)).toEqual(["p0", "s0"]);
    expect(hitFootprint(fp, [0, 0.4], 0.1)).toEqual(["s0"]);
    expect(hitFootprint(fp, [0, 3], 0.1)).toEqual([]);
    expect(itemBox(fp, "p1")).toEqual({ x1: 0.5, y1: -0.3, x2: 1.5, y2: 0.3 });
    // A pad turned a quarter swaps its sides.
    expect(itemBox(setPads(fp, ["p1"], { angle: 90 }), "p1")).toEqual({ x1: 0.7, y1: -0.5, x2: 1.3, y2: 0.5 });
    expect(itemBox(fp, "p9")).toBeNull();
    expect(landBox(fp)).toEqual({ x1: -1.5, y1: -0.4, x2: 1.5, y2: 0.4 });
    expect(landBox(empty())).toEqual({ x1: -3, y1: -3, x2: 3, y2: 3 });
  });

  it("draws outlines on a layer with that layer's line width, and moves them between layers", () => {
    const silk = addOutline(
      pair(),
      {
        kind: "line",
        pts: [
          [-1.5, 0.6],
          [1.5, 0.6],
        ],
      },
      "silk",
    );
    expect(silk.fp.shapes[1]).toMatchObject({ layer: "silk", width: 0.12 });
    expect(setOutline(silk.fp, silk.id, { layer: "courtyard" }).shapes[1]).toMatchObject({ layer: "courtyard" });
  });

  it("wraps a courtyard round the pads and the body, and again after they move", () => {
    const once = wrapCourtyard(pair());
    expect(once.shapes.filter((s) => s.layer === "courtyard")).toEqual([
      { kind: "rect", layer: "courtyard", x1: -1.75, y1: -0.65, x2: 1.75, y2: 0.65, width: 0.05 },
    ]);
    const again = wrapCourtyard(moveItems(once, ["p1"], 1, 0));
    expect(again.shapes.filter((s) => s.layer === "courtyard")).toHaveLength(1);
    expect(again.shapes.at(-1)).toMatchObject({ x2: 2.75 });
    expect(wrapCourtyard(empty())).toEqual(empty());
  });
});
