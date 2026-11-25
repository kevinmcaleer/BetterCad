import { describe, expect, it } from "vitest";
import { bigBoard } from "./big";
import { netlist } from "../nets";
import { checkBoard } from "./drc";
import { slideTrack } from "./slide";
import { boardState } from "./state";

describe("a 500 part board", () => {
  it("is checked in a few seconds (#644)", () => {
    const d = bigBoard(500);
    expect(d.board!.placements).toHaveLength(500);
    expect(d.board!.tracks).toHaveLength(480);
    const t = performance.now();
    expect(checkBoard(d)).toEqual([]);
    // About 0.2 s on a laptop; a CI runner is two to three times slower.
    expect(performance.now() - t).toBeLessThan(3000);
  });

  it("has 5,000 pieces of track and is still quick to change (#640)", () => {
    const d = bigBoard(1750, 50);
    const pieces = d.board!.tracks.reduce((n, t) => n + t.pts.length - 1, 0);
    expect(pieces).toBeGreaterThan(5000);
    // The nets are read once from the schematic and kept while only the board changes.
    const t0 = performance.now();
    const nl = netlist(d);
    expect(performance.now() - t0).toBeLessThan(1500);
    const track = d.board!.tracks[900]!;
    // What every step of a drag does: slide the piece, then work out the board's copper and what is left to route.
    const t = performance.now();
    let slid = d;
    for (let i = 1; i <= 10; i += 1) {
      slid = slideTrack(d, track.id, 1, [0, i * 0.05]);
      expect(netlist(slid)).toBe(nl);
      boardState(slid, nl);
    }
    // About 15 ms a step on a laptop.
    expect((performance.now() - t) / 10).toBeLessThan(150);
    expect(slid.board!.tracks[900]!.pts[1]![1]).toBeCloseTo(track.pts[1]![1] + 0.5, 6);
  });
});
