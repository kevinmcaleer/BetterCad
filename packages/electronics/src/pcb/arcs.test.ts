import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { joinRuns } from "../boardIn";
import { importEagleProject } from "../eagle/project";
import { gerberFiles } from "../fab/gerber";
import { readGerber } from "../fab/read";
import { kicadProject } from "../kicad/export";
import { importKicadProject } from "../kicad/project";
import type { ElectronicsDesign, P2, Track, Via } from "../model";
import { sampleBoard } from "../sample";
import { bulgeOfTurn, curved, pathLength, trackPath, turnOf } from "../trackArcs";
import { autoroute } from "./autoroute";
import { checkBoard } from "./drc";
import { shove } from "./push";
import { roundedOutline, trackLength } from "./route";
import { netLength } from "./shove";
import { slidePiece, slideTrack } from "./slide";

const via = (id: string, net: string, x: number, y: number): Via => ({ id, net, x, y, diameter: 0.6, drill: 0.3 });
/** A half circle of radius 10 about (20, 20): anticlockwise from (10, 20), so it bulges down through (20, 10). */
const arc: Track = { id: "a", net: "A", layer: "top", width: 0.25, pts: [[10, 20], [30, 20]], arcs: [1] }; // prettier-ignore

function board(tracks: Track[], vias: Via[] = []): ElectronicsDesign {
  const d = sampleBoard();
  return {
    ...d,
    parts: [],
    board: { ...d.board!, outline: roundedOutline(60, 40), cutouts: [], placements: [], vias, pours: [], holes: [], texts: [], keepouts: [], tracks },
  };
}
const clashes = (d: ElectronicsDesign) => checkBoard(d).filter((e) => e.rule === "clearance");

describe("curved tracks (#755)", () => {
  it("are checked along the curve, not the straight line between their ends", () => {
    expect(clashes(board([arc], [via("v", "B", 20, 9.4)]))).toHaveLength(1);
    expect(clashes(board([arc], [via("v", "B", 20, 19.5)]))).toEqual([]);
    expect(trackLength(arc.pts, arc.arcs)).toBeCloseTo(Math.PI * 10, 6);
    expect(netLength(board([arc]), "A")).toBeCloseTo(Math.PI * 10, 6);
  });

  it("keep their curves when a piece next to them slides, and are walked round, not pushed", () => {
    // A straight piece, then a quarter turn.
    const t: Track = { id: "t", net: "A", layer: "top", width: 0.25, pts: [[10, 10], [20, 10], [25, 15]], arcs: [0, bulgeOfTurn(90)] }; // prettier-ignore
    const slid = slidePiece(t.pts, 0, [0, -1], t.arcs)!;
    expect(slid.pts.at(-1)).toEqual([25, 15]);
    expect(turnOf(slid.arcs!.at(-1)!)).toBeCloseTo(90, 6);
    const moved = slideTrack(board([t]), "t", 0, [0, -1]).board!.tracks[0]!;
    expect(curved(moved)).toBe(true);
    // A run along the curve's bottom has nothing it can push.
    expect(
      shove(board([arc]), {
        net: "B",
        layer: "top",
        width: 0.25,
        pts: [
          [15, 9.8],
          [25, 9.8],
        ],
      }),
    ).toBeNull();
  });

  it("can round the autorouter's corners, and the board still passes its check", () => {
    const start: ElectronicsDesign = { ...sampleBoard(), board: { ...sampleBoard().board!, tracks: [], vias: [] } };
    const r = autoroute(start, { round: 1 });
    expect(r.failed).toEqual([]);
    const tracks = r.design.board!.tracks;
    expect(tracks.some(curved)).toBe(true);
    for (const t of tracks.filter(curved)) expect(t.arcs).toHaveLength(t.pts.length - 1);
    expect(checkBoard(r.design)).toEqual([]);
    // A rounded run is shorter than the same run with sharp corners.
    const sharp = autoroute(start);
    const total = (d: ElectronicsDesign) => d.board!.tracks.reduce((n, t) => n + pathLength(t), 0);
    expect(total(r.design)).toBeLessThan(total(sharp.design));
  }, 30000);

  it("go to Gerber as arcs, which read back on the curve", () => {
    const d = board([arc]);
    const top = gerberFiles(d).find((f) => f.layer === "copper-top")!.text;
    expect(top).toMatch(/G03\*\nX30000000Y20000000I10000000J0D01\*/);
    const read = readGerber(top);
    const drawn = read.ops.filter((o) => o.kind === "draw").flatMap((o) => o.pts as P2[]);
    expect(drawn.some((p) => Math.abs(p[0] - 20) < 0.05 && Math.abs(p[1] - 10) < 0.05)).toBe(true);
  });

  it("go out to KiCad as arcs and come back the same", () => {
    const d = board([arc]);
    const out = kicadProject(d, "arc");
    const pcb = out.files.find((f) => f.name.endsWith(".kicad_pcb"))!.text;
    expect(pcb).toMatch(/\(arc\s+\(start [^)]*\)\s+\(mid [^)]*\)\s+\(end/);
    const back = importKicadProject(out.files.map((f) => ({ name: f.name, text: f.text })));
    const t = back.design.board!.tracks.find(curved)!;
    expect(t).toBeDefined();
    expect(pathLength(t)).toBeCloseTo(Math.PI * 10, 3);
    expect(back.notes.some((n) => /curved/.test(n.why))).toBe(false);
  });

  it("come in from Eagle as arcs", () => {
    const dir = join(__dirname, "../eagle/fixtures");
    const got = importEagleProject(["turns.sch", "turns.brd"].map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") })));
    const t = got.design.board!.tracks.find(curved);
    expect(t).toBeDefined();
    expect(trackPath(t!).length).toBeGreaterThan(t!.pts.length);
  });

  it("join up from pieces with each curve the right way round", () => {
    // Two quarter turns given end to end, the second one backwards.
    const [t] = joinRuns([
      {
        net: "A",
        layer: "top",
        width: 0.25,
        pieces: [
          [[0, 0], [10, 0], 0],
          [[15, 5], [10, 0], -bulgeOfTurn(90)],
        ],
      },
    ]); // prettier-ignore
    expect(t!.pts).toEqual([[0, 0], [10, 0], [15, 5]]); // prettier-ignore
    expect(turnOf(t!.arcs![1]!)).toBeCloseTo(90, 6);
  });
});
