import { describe, expect, it } from "vitest";
import { boardPads } from "../board";
import { segmentDistance } from "../geom";
import type { ElectronicsDesign, P2, Track, Via } from "../model";
import { sampleBoard } from "../sample";
import { bigBoard } from "./big";
import { copperOf, edgeLoops, type Copper } from "./copper";
import { dragPushing, routeOn, shove, walkRound } from "./push";
import { blockers, roundedOutline } from "./route";

const track = (id: string, net: string, pts: P2[], width = 0.25): Track => ({ id, net, layer: "top", width, pts });
const via = (id: string, net: string, x: number, y: number): Via => ({ id, net, x, y, diameter: 0.6, drill: 0.3 });

function board(tracks: Track[], vias: Via[] = [], keepouts: NonNullable<ElectronicsDesign["board"]>["keepouts"] = []): ElectronicsDesign {
  const d = sampleBoard();
  return {
    ...d,
    parts: [],
    board: { ...d.board!, outline: roundedOutline(60, 40), cutouts: [], placements: [], vias, pours: [], holes: [], texts: [], keepouts, tracks },
  };
}

/** Whether every track and via on the board keeps its clearance. */
function clean(d: ElectronicsDesign): boolean {
  const b = d.board!;
  const copper = copperOf(d, []);
  const loops = edgeLoops(b);
  return (
    b.tracks.every(
      (t) =>
        !blockers(
          b,
          copper.filter((c) => c.id !== t.id),
          loops,
          { net: t.net, layers: [t.layer], pts: t.pts, width: t.width },
        ).length,
    ) &&
    b.vias.every(
      (v) =>
        !blockers(
          b,
          copper.filter((c) => c.id !== v.id),
          loops,
          { net: v.net, layers: ["top", "bottom"], pts: [[v.x, v.y]], width: v.diameter },
        ).length,
    )
  );
}

/** Every piece runs straight across, up, or at 45°. */
const octilinear = (pts: P2[]) =>
  pts.slice(1).every((b, i) => {
    const dx = Math.abs(b[0] - pts[i]![0]);
    const dy = Math.abs(b[1] - pts[i]![1]);
    return dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-4;
  });

describe("the router pushes vias (#753)", () => {
  it("moves a via in the way straight off, with its tracks' ends, and keeps every clearance", () => {
    const d = board([track("a", "A", [[30, 15], [30, 10.4]])], [via("v", "A", 30, 10.4)]); // prettier-ignore
    const run = { net: "B", layer: "top" as const, width: 0.25, pts: [[20, 10], [40, 10]] as P2[] }; // prettier-ignore
    const out = shove(d, run)!;
    expect(out).not.toBeNull();
    const v = out.board!.vias[0]!;
    // Away from the new run: up off it, which is the way it sat.
    expect(v.y).toBeGreaterThan(10.4);
    expect(v.x).toBeCloseTo(30, 6);
    expect(segmentDistance([v.x, v.y], [v.x, v.y], run.pts[0]!, run.pts[1]!)).toBeGreaterThanOrEqual(d.board!.rules.clearance + 0.3 + 0.125 - 1e-6);
    // Its track still ends on it.
    expect(out.board!.tracks[0]!.pts.at(-1)).toEqual([v.x, v.y]);
    expect(clean({ ...out, board: { ...out.board!, tracks: [...out.board!.tracks, { id: "n", ...run }] } })).toBe(true);
  });

  it("passes a push from a via on to the track beside it, and says no when a keep-out holds it", () => {
    const d = board(
      [track("b", "C", [[20, 16], [24, 11.2], [36, 11.2], [40, 16]])], // prettier-ignore
      [via("v", "A", 30, 10.4)],
    );
    const run = { net: "B", layer: "top" as const, width: 0.25, pts: [[20, 10], [40, 10]] as P2[] }; // prettier-ignore
    const out = shove(d, run)!;
    expect(out).not.toBeNull();
    // Only the stretch beside the via bends out of its way.
    expect(out.board!.tracks[0]!.pts.some((p) => p[1] > 11.2 && p[1] < 16)).toBe(true);
    expect(out.board!.vias[0]!.y).toBeGreaterThan(10.4);
    // A keep-out over the via's way leaves it nowhere to go.
    const held = board([], [via("v", "A", 30, 10.4)], [{ id: "k", outline: [[25, 10.8], [35, 10.8], [35, 14], [25, 14]], tracks: true, vias: true, pours: true }] as never); // prettier-ignore
    expect(shove(held, run)).toBeNull();
  });
});

describe("the router walks round what cannot move (#753)", () => {
  it("goes round a pad in the way in straight runs and 45° corners, clear of it", () => {
    const d = board([]);
    // A round pad of one net, and a way straight through it for another.
    const pad: Copper = { kind: "pad", pts: [[30, 10]], r: 1, net: "A", layers: ["top", "bottom"], id: "p", what: "J1 pad 1", at: [30, 10] };
    const net = "B";
    const from: P2 = [26, 10];
    const to: P2 = [34, 10];
    const copper = [pad];
    const run = { net, layer: "top" as const, width: 0.25 };
    const pts = walkRound(d.board!, copper, run, from, to);
    expect(pts).not.toBeNull();
    expect(pts![0]).toEqual(from);
    expect(pts!.at(-1)).toEqual(to);
    expect(pts!.length).toBeGreaterThan(2);
    expect(octilinear(pts!)).toBe(true);
    expect(blockers(d.board!, copper, edgeLoops(d.board!), { ...run, layers: ["top"], pts: pts! }).length).toBe(0);
  });

  it("pushes what can move and walks round what cannot, or only walks with Push off", () => {
    // A track of another net across the way, and a via that can't be pushed far enough past the edge.
    const d = board([track("a", "A", [[25, 15], [25, 10.2], [35, 10.2], [35, 15]])]); // prettier-ignore
    const run = { net: "B", layer: "top" as const, width: 0.25 };
    const pushed = routeOn(d, run, [20, 10], [40, 10], { push: true, walk: true }, []);
    expect(pushed?.pushed).toBeDefined();
    expect(pushed!.pts).toEqual([[20, 10], [40, 10]]); // prettier-ignore
    const walked = routeOn(d, run, [20, 10], [40, 10], { push: false, walk: true }, []);
    expect(walked?.pushed).toBeUndefined();
    expect(walked!.pts.length).toBeGreaterThan(2);
    expect(octilinear(walked!.pts)).toBe(true);
    expect(routeOn(d, run, [20, 10], [40, 10], { push: false, walk: false }, [])).toBeNull();
  });
});

describe("dragging track pushes its neighbours (#753)", () => {
  it("slides a piece into its neighbour, which moves aside, and goes back when there is no room", () => {
    const d = board([
      track("a", "A", [[10, 10], [40, 10]]), // prettier-ignore
      track("b", "B", [[16, 16], [16, 11], [34, 11], [34, 16]]), // prettier-ignore
    ]);
    const out = dragPushing(d, "a", 0, [0, 0.6], []);
    expect(out).not.toBe(d);
    const a = out.board!.tracks.find((t) => t.id === "a")!;
    const b = out.board!.tracks.find((t) => t.id === "b")!;
    expect(Math.max(...a.pts.map((p) => p[1]))).toBeCloseTo(10.6, 6);
    expect(Math.max(...b.pts.map((p) => p[1]))).toBeGreaterThan(11);
    expect(clean(out)).toBe(true);
    // Into the board's edge: nothing changes.
    const edge = board([track("a", "A", [[10, 30], [10, 37], [40, 37], [40, 30]]), track("b", "B", [[16, 30], [16, 38.6], [34, 38.6], [34, 30]])]); // prettier-ignore
    expect(dragPushing(edge, "a", 0, [0, 1.2], [])).toBe(edge);
  });

  it("holds up on the 1,750 part board", () => {
    const d = bigBoard(1750, 50);
    const pads = boardPads(d);
    const t = d.board!.tracks[900]!;
    const t0 = performance.now();
    const out = dragPushing(d, t.id, 1, [0, 0.3], pads);
    const pts = routeOn(
      d,
      { net: "", layer: "top", width: 0.25 },
      [t.pts[1]![0], t.pts[1]![1] + 2],
      [t.pts[2]![0], t.pts[2]![1] + 2],
      { push: true, walk: true },
      pads,
    );
    // About 0.3 s on a laptop; a CI runner is two to three times slower.
    expect(performance.now() - t0).toBeLessThan(4000);
    expect(out).toBeDefined();
    expect(pts).not.toBeNull();
  });
});
