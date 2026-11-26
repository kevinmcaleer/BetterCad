import { describe, expect, it } from "vitest";
import type { ElectronicsDesign, P2 } from "../model";
import { sampleBoard } from "../sample";
import { addAreaCorner, areaCorners, cornerMoved, moveAreaCorner, moveTrackCorner, removeAreaCorner } from "./corners";
import { addKeepoutArea, addCutout } from "./pour";
import { addTrack } from "./route";

describe("dragging corners (#742)", () => {
  it("moves a track's bend, bending again at 45° where it must", () => {
    const pts: P2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    // Straight along and straight up still: no new bends.
    expect(cornerMoved(pts, 1, [10, 0])).toEqual(pts);
    expect(cornerMoved(pts, 1, [5, 0])).toEqual([
      [0, 0],
      [5, 0],
      [10, 5],
      [10, 10],
    ]);
    // Off the lines either side: each side gets a 45° bend.
    const out = cornerMoved(pts, 1, [12, 3])!;
    expect(out[0]).toEqual([0, 0]);
    expect(out.at(-1)).toEqual([10, 10]);
    expect(out).toContainEqual([12, 3]);
    for (let k = 0; k + 1 < out.length; k += 1) {
      const dx = Math.abs(out[k + 1]![0] - out[k]![0]);
      const dy = Math.abs(out[k + 1]![1] - out[k]![1]);
      expect(dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6).toBe(true);
    }
    // The ends stay where they are.
    expect(cornerMoved(pts, 0, [1, 1])).toBeNull();
    expect(cornerMoved(pts, 2, [1, 1])).toBeNull();
  });

  it("moves a bend of a track on the board", () => {
    const d = addTrack(sampleBoard(), "GND", "top", [
      [1, 1],
      [6, 1],
      [6, 6],
    ]);
    const t = d.board!.tracks.at(-1)!;
    expect(moveTrackCorner(d, t.id, 1, [4, 1]).board!.tracks.at(-1)!.pts).toEqual([
      [1, 1],
      [4, 1],
      [6, 3],
      [6, 6],
    ]);
  });

  it("drags, adds and takes away an area's corners", () => {
    let d: ElectronicsDesign = sampleBoard();
    d = addKeepoutArea(d, [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    const id = d.board!.keepouts.at(-1)!.id;
    d = moveAreaCorner(d, id, 2, [12, 12]);
    expect(areaCorners(d.board!, id)![2]).toEqual([12, 12]);
    const added = addAreaCorner(d, id, 0, [5, -2]);
    expect(added.i).toBe(1);
    expect(areaCorners(added.design.board!, id)).toEqual([
      [0, 0],
      [5, -2],
      [10, 0],
      [12, 12],
      [0, 10],
    ]);
    d = removeAreaCorner(added.design, id, 1);
    d = removeAreaCorner(d, id, 0);
    expect(areaCorners(d.board!, id)).toHaveLength(3);
    // Three is the least an area keeps.
    expect(removeAreaCorner(d, id, 0)).toBe(d);
  });

  it("works on a cut-out, and straightens an arc it splits", () => {
    let d: ElectronicsDesign = sampleBoard();
    const n = d.board!.cutouts?.length ?? 0;
    d = addCutout(d, [
      [20, 20],
      [24, 20],
      [24, 24],
    ]);
    const id = `cut:${n}`;
    d = { ...d, board: { ...d.board!, cutouts: d.board!.cutouts!.map((l, k) => (k === n ? l.map((c, j) => (j === 0 ? { ...c, bulge: 0.5 } : c)) : l)) } };
    const added = addAreaCorner(d, id, 0, [22, 19]).design;
    expect(added.board!.cutouts![n]).toEqual([
      { x: 20, y: 20 },
      { x: 22, y: 19 },
      { x: 24, y: 20 },
      { x: 24, y: 24 },
    ]);
    expect(moveAreaCorner(added, id, 3, [25, 25]).board!.cutouts![n]![3]).toEqual({ x: 25, y: 25 });
  });
});
