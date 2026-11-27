import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

describe("the autorouter takes its own tracks up, and reaches pads off its grid (#754)", () => {
  const fixture = (name: string): ElectronicsDesign =>
    bare(JSON.parse(readFileSync(join(__dirname, `../../../../fixtures/electronics/${name}.design.json`), "utf8")) as ElectronicsDesign);

  it("routes the sample board and two denser boards from bare, and each passes the board check", () => {
    for (const d of [bare(sampleBoard()), fixture("pico-servo-board"), fixture("tangle")]) {
      const r = autoroute(d);
      expect(r.failed).toEqual([]);
      expect(r.routed).toBe(r.total);
      expect(checkBoard(r.design).filter((e) => e.level === "error")).toEqual([]);
    }
  });

  it("makes a connection it had no way for by taking up its own routes nearby and laying them again", () => {
    const d = fixture("tangle");
    const once = autoroute(d, { layers: ["top"], ripUp: false });
    const again = autoroute(d, { layers: ["top"] });
    expect(again.routed).toBeGreaterThan(once.routed);
    expect(again.failed.length).toBeLessThan(once.failed.length);
    expect(errors(again.design).filter((e) => e.level === "error")).toEqual([]);
    expect(applyRoutes(d, again.routes).board!.tracks.length).toBe(again.design.board!.tracks.length);
  });

  it("never moves a track that was on the board before it started", () => {
    const whole = JSON.parse(readFileSync(join(__dirname, "../../../../fixtures/electronics/tangle.design.json"), "utf8")) as ElectronicsDesign;
    const kept = whole.board!.tracks.filter((_, i) => i % 3 === 0);
    const some = { ...whole, board: { ...whole.board!, tracks: kept, vias: [] } };
    const r = autoroute(some, { layers: ["top"] });
    for (const t of kept) expect(r.design.board!.tracks.find((x) => x.id === t.id)!.pts.slice(0, t.pts.length)).toEqual(t.pts);
  });

  it("reaches a pad between its grid lines with a short exact piece", () => {
    const start = bare(sampleBoard());
    const r = autoroute(start, { pitch: 0.4, fanout: false });
    expect(r.failed).toEqual([]);
    const pads = boardState(start).pads.map((p) => p.at);
    const onPad = (p: [number, number]) => pads.some((a) => Math.abs(a[0] - p[0]) < 1e-6 && Math.abs(a[1] - p[1]) < 1e-6);
    // Every route starts and ends dead on a pad, whatever the grid.
    for (const route of r.routes) {
      const first = route.tracks[0]!.pts[0]!;
      const last = route.tracks.at(-1)!.pts.at(-1)!;
      expect(onPad(first) && onPad(last)).toBe(true);
    }
    expect(errors(r.design).filter((e) => e.level === "error")).toEqual([]);
  });
});
