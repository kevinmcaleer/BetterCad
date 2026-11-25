import { describe, expect, it } from "vitest";
import type { ElectronicsDesign, P2, Track } from "../model";
import { segmentDistance } from "../geom";
import { sampleBoard } from "../sample";
import { checkBoard } from "./drc";
import { layPair, netLength, offsetRun, pairOf, pairRuns, shove, tuneLength, wiggles } from "./shove";
import { roundedOutline, trackLength } from "./route";

const track = (id: string, net: string, pts: P2[], width = 0.25): Track => ({ id, net, layer: "top", width, pts });

function board(tracks: Track[]): ElectronicsDesign {
  const d = sampleBoard();
  return {
    ...d,
    parts: [],
    board: { ...d.board!, outline: roundedOutline(60, 40), cutouts: [], placements: [], vias: [], pours: [], holes: [], texts: [], keepouts: [], tracks },
  };
}

/** The least distance between the centre lines of two runs. */
const apart = (a: P2[], b: P2[]): number => {
  let best = Infinity;
  for (let i = 0; i + 1 < a.length; i += 1)
    for (let j = 0; j + 1 < b.length; j += 1) best = Math.min(best, segmentDistance(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!));
  return best;
};

describe("shove (#646)", () => {
  it("slides a track aside just far enough for the new one, and keeps the clearance", () => {
    const d = board([
      track("a", "A", [
        [10, 10],
        [40, 10],
      ]),
    ]);
    const clearance = d.board!.rules.clearance;
    const run = {
      net: "B",
      layer: "top" as const,
      width: 0.25,
      pts: [
        [15, 10.2],
        [35, 10.2],
      ] as P2[],
    };
    const out = shove(d, run);
    expect(out).not.toBeNull();
    const a = out!.board!.tracks[0]!;
    // Its ends stay where they were: they sit on pads.
    expect(a.pts[0]).toEqual([10, 10]);
    expect(a.pts.at(-1)).toEqual([40, 10]);
    expect(apart(a.pts, run.pts)).toBeGreaterThanOrEqual(clearance + 0.25 - 1e-6);
    expect(apart(a.pts, run.pts)).toBeLessThan(clearance + 0.25 + 0.1);
    // It went away from the new run: down.
    expect(Math.min(...a.pts.map((p) => p[1]))).toBeLessThan(10);
  });

  it("passes the push on to the next track", () => {
    const d = board([
      track("a", "A", [
        [10, 10],
        [40, 10],
      ]),
      track("c", "C", [
        [10, 9.5],
        [40, 9.5],
      ]),
    ]);
    const run = {
      net: "B",
      layer: "top" as const,
      width: 0.25,
      pts: [
        [15, 10.2],
        [35, 10.2],
      ] as P2[],
    };
    const out = shove(d, run)!;
    expect(out).not.toBeNull();
    const [a, c] = out.board!.tracks;
    expect(c!.pts).not.toEqual(d.board!.tracks[1]!.pts);
    const laid = { ...out, board: { ...out.board!, tracks: [...out.board!.tracks, track("b", "B", run.pts)] } };
    expect(checkBoard(laid).filter((r) => r.rule === "clearance" || r.rule === "short")).toEqual([]);
    expect(apart(a!.pts, c!.pts)).toBeGreaterThanOrEqual(d.board!.rules.clearance + 0.25 - 1e-6);
  });

  it("says no when the track would have to go off the board, cross, or is another side's", () => {
    const edge = board([
      track("a", "A", [
        [10, 0.5],
        [40, 0.5],
      ]),
    ]);
    expect(
      shove(edge, {
        net: "B",
        layer: "top",
        width: 0.25,
        pts: [
          [15, 0.8],
          [35, 0.8],
        ],
      }),
    ).toBeNull();
    const cross = board([
      track("a", "A", [
        [10, 10],
        [40, 10],
      ]),
    ]);
    expect(
      shove(cross, {
        net: "B",
        layer: "top",
        width: 0.25,
        pts: [
          [20, 5],
          [20, 15],
        ],
      }),
    ).toBeNull();
    // Nothing in the way on the other side: the design comes back as it was.
    expect(
      shove(cross, {
        net: "B",
        layer: "bottom",
        width: 0.25,
        pts: [
          [15, 10.2],
          [35, 10.2],
        ],
      }),
    ).toBe(cross);
  });
});

describe("length tuning (#646)", () => {
  it("wiggles add exactly the length asked for", () => {
    const w = wiggles([0, 0], [20, 0], 3, 0.25)!;
    expect(trackLength(w)).toBeCloseTo(23, 4);
    expect(w[0]).toEqual([0, 0]);
    expect(w.at(-1)).toEqual([20, 0]);
    // A little extra makes low bumps with slanted sides.
    expect(trackLength(wiggles([0, 0], [20, 0], 0.3, 0.25, -1)!)).toBeCloseTo(20.3, 4);
    expect(wiggles([0, 0], [2, 0], 30, 0.25)).toBeNull();
  });

  it("makes a net the length asked for, on the side with room", () => {
    const d = board([
      track("a", "A", [
        [10, 10],
        [40, 10],
        [45, 15],
      ]),
      // Something along one side.
      track("c", "C", [
        [10, 10.6],
        [38, 10.6],
      ]),
    ]);
    const now = netLength(d, "A");
    const out = tuneLength(d, "a", now + 4);
    expect("design" in out).toBe(true);
    if (!("design" in out)) return;
    expect(out.length).toBeCloseTo(now + 4, 3);
    expect(checkBoard(out.design).filter((r) => r.rule === "clearance" || r.rule === "short")).toEqual([]);
    expect(Math.min(...out.design.board!.tracks[0]!.pts.map((p) => p[1]))).toBeLessThan(10);
  });

  it("says why when it cannot", () => {
    const d = board([
      track("a", "A", [
        [10, 10],
        [12, 10],
      ]),
    ]);
    expect(tuneLength(d, "a", 1)).toEqual({ why: expect.stringContaining("only makes a net longer") });
    expect(tuneLength(d, "a", 30)).toEqual({ why: expect.stringContaining("long enough") });
  });
});

describe("paired tracks (#646)", () => {
  it("finds a net's partner by its name", () => {
    const nets = ["D+", "D-", "USB_P", "USB_N", "GND", "TXP", "TXN", "EN"];
    expect(pairOf("D+", nets)).toBe("D-");
    expect(pairOf("USB_N", nets)).toBe("USB_P");
    expect(pairOf("TXP", nets)).toBe("TXN");
    expect(pairOf("GND", nets)).toBeNull();
    expect(pairOf("EN", nets)).toBeNull();
  });

  it("keeps the gap round corners", () => {
    const centre: P2[] = [
      [10, 10],
      [20, 10],
      [25, 15],
      [25, 25],
    ];
    const left = offsetRun(centre, 0.225)!;
    const right = offsetRun(centre, -0.225)!;
    expect(apart(left, right)).toBeCloseTo(0.45, 5);
    // Each piece of one stays the pitch from the other, corners included.
    for (let i = 0; i + 1 < left.length; i += 1) expect(apart([left[i]!, left[i + 1]!], right)).toBeCloseTo(0.45, 5);
    expect(
      offsetRun(
        [
          [0, 0],
          [0.1, 0],
          [0.1, 5],
        ],
        2,
      ),
    ).toBeNull();
  });

  it("lays both tracks from their pads and onto the pads they land on", () => {
    const centre: P2[] = [
      [10, 10],
      [20, 10],
      [25, 15],
      [25, 25],
    ];
    const runs = pairRuns(centre, 0.45, { from: [10, 11.27], to: [23.73, 25] }, { from: [10, 8.73], to: [26.27, 25] })!;
    expect(runs.a[0]).toEqual([10, 11.27]);
    expect(runs.a.at(-1)).toEqual([23.73, 25]);
    expect(runs.b[0]).toEqual([10, 8.73]);
    expect(runs.b.at(-1)).toEqual([26.27, 25]);
    expect(apart(runs.a, runs.b)).toBeCloseTo(0.45, 5);
    const d = layPair(board([]), ["p", "n"], ["D+", "D-"], "top", runs, 0.25);
    expect(d.board!.tracks.map((t) => t.net)).toEqual(["D+", "D-"]);
    expect(checkBoard(d).filter((r) => r.rule === "clearance" || r.rule === "short")).toEqual([]);
    // Laid again a click later, it is still two tracks.
    expect(layPair(d, ["p", "n"], ["D+", "D-"], "top", runs, 0.25).board!.tracks).toHaveLength(2);
  });
});
