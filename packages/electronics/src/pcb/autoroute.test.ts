import { describe, expect, it } from "vitest";
import { ratsnest } from "../board";
import type { ElectronicsDesign } from "../model";
import { sampleBoard } from "../sample";
import { applyRoutes, autoroute, type RouteProgress } from "./autoroute";
import { checkBoard } from "./drc";
import { addKeepout } from "./route";
import { boardState } from "./state";

const bare = (d: ElectronicsDesign): ElectronicsDesign => ({ ...d, board: { ...d.board!, tracks: [], vias: [] } });
const left = (d: ElectronicsDesign) => {
  const s = boardState(d);
  return ratsnest(s.pads, s.joined);
};
const errors = (d: ElectronicsDesign) => checkBoard(d).filter((r) => r.rule !== "unrouted");

describe("the autorouter (#647)", () => {
  const start = bare(sampleBoard());

  it("routes every connection of the sample board, and the result passes the board check", () => {
    const seen: RouteProgress[] = [];
    const todo = left(start).length;
    expect(todo).toBeGreaterThan(10);
    const r = autoroute(start, { onProgress: (p) => seen.push(p) });
    expect(r).toMatchObject({ routed: todo, total: todo, failed: [] });
    expect(checkBoard(r.design)).toEqual([]);
    expect(seen).toHaveLength(todo);
    expect(seen[todo - 1]).toMatchObject({ done: todo, total: todo, routed: todo, failed: 0 });
    // The routes alone lay the same board, so the page can lay them as one step.
    expect(applyRoutes(start, r.routes).board!.tracks.map((t) => t.pts)).toEqual(r.design.board!.tracks.map((t) => t.pts));
  });

  it("leaves tracks and vias already on the board as they are", () => {
    const whole = sampleBoard();
    const kept = whole.board!.tracks.filter((_, i) => i % 2 === 0);
    const half = { ...whole, board: { ...whole.board!, tracks: kept } };
    const r = autoroute(half);
    expect(r.routed).toBeGreaterThan(0);
    for (const t of kept) expect(r.design.board!.tracks.find((x) => x.id === t.id)!.pts.slice(0, t.pts.length)).toEqual(t.pts);
    expect(r.design.board!.vias.slice(0, whole.board!.vias.length)).toEqual(whole.board!.vias);
    // The tracks taken out left their neighbours ending in mid air: a warning of this test's own making.
    expect(errors(r.design).filter((e) => e.rule !== "track-open")).toEqual([]);
  });

  it("routes only the nets or the parts asked for", () => {
    const net = left(start)[0]!.net;
    const one = autoroute(start, { nets: [net] });
    expect(one.routed).toBeGreaterThan(0);
    expect(new Set(one.design.board!.tracks.map((t) => t.net))).toEqual(new Set([net]));
    expect(left(one.design).some((a) => a.net === net)).toBe(false);

    const part = boardState(start).pads.find((p) => p.net === net)!.part;
    const some = autoroute(start, { parts: [part] });
    expect(some.routed).toBeGreaterThan(0);
    expect(some.total).toBeLessThan(left(start).length);
  });

  it("keeps to one side when asked, with no vias", () => {
    const r = autoroute(start, { layers: ["top"] });
    expect(r.routed).toBeGreaterThan(0);
    expect(r.design.board!.vias).toEqual([]);
    expect(r.design.board!.tracks.every((t) => t.layer === "top")).toBe(true);
    expect(errors(r.design)).toEqual([]);
  });

  it("lists the connections it finds no way for, and lays nothing for them", () => {
    const air = left(start).sort((x, y) => Math.hypot(y.a[0] - y.b[0], y.a[1] - y.b[1]) - Math.hypot(x.a[0] - x.b[0], x.a[1] - x.b[1]))[0]!;
    // A keep-out all round one end.
    const [x, y] = air.a;
    let walled = start;
    for (const [p, c] of [
      [
        [x - 6, y - 6],
        [x + 6, y - 5],
      ],
      [
        [x - 6, y + 5],
        [x + 6, y + 6],
      ],
      [
        [x - 6, y - 6],
        [x - 5, y + 6],
      ],
      [
        [x + 5, y - 6],
        [x + 6, y + 6],
      ],
    ] as [[number, number], [number, number]][])
      walled = addKeepout(walled, p, c);
    const r = autoroute(walled, { nets: [air.net] });
    expect(r.failed.length).toBeGreaterThan(0);
    expect(r.failed[0]!.net).toBe(air.net);
    expect(errors(r.design).filter((e) => e.rule === "keepout" && /track/.test(e.text))).toEqual([]);
  });

  it("does nothing on a design with no board", () => {
    const d = { ...start, board: undefined } as ElectronicsDesign;
    expect(autoroute(d)).toMatchObject({ design: d, routes: [], routed: 0, total: 0 });
  });
});
