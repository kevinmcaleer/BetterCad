import { GRID, header, resistor } from "../basics";
import { boardPads, ratsnest } from "../board";
import { addWire, placePart } from "../edit";
import { swapGroups, swapPins } from "../swap";
import { netlist } from "../nets";
import { check, waive } from "../erc";
import { emptyDesign, type ElectronicsDesign, type P2 } from "../model";
import { pushToBoard } from "../sync";
import { copperOf, edgeGap, edgeLoops, gap, netRules, padSolid } from "./copper";
import { BOARD_RULES, checkBoard, placeClashes, waiveBoard, type BoardRuleId } from "./drc";
import {
  addHole,
  addKeepout,
  addText,
  addTrack,
  addVia,
  alignParts,
  blockers,
  corner45,
  deleteParts,
  outlineRadius,
  renumberOnBoard,
  ripUpNet,
  clearRoutes,
  roundedOutline,
  setBoard,
  setPlacement,
  tidyRun,
  toggleLock,
} from "./route";
import { followSketch, outlineBehind, outlineOf, unfollowSketch } from "./outline";
import { addKeepoutArea, addCutout, addPour, pourFill, pourShape, removeAreas, setPadJoin, setPour, wholeBoard, type PourFill } from "./pour";
import { PRESETS, applyPreset, keepRules, matchesPreset, presetChanges, setRule } from "./rules";
import { boardState } from "./state";

const G = GRID;

/** R1 and J1 on a 50 by 40 mm board, each pin of R1 wired to the same-numbered pin of J1. */
function netted(): { d: ElectronicsDesign; pad: (ref: string, n: string) => P2 } {
  let d = emptyDesign();
  const r = placePart(d, "sh1", resistor(), { x: 0, y: 0 });
  const j = placePart(r.design, "sh1", header(2), { x: 20 * G, y: 0 });
  d = j.design;
  // A wire from each pin of R1 to the same pin of J1, by way of rows that do not cross.
  const at = (part: string, pin: string): P2 => {
    const sym = d.sheets[0]!.symbols.find((s) => s.part === part)!;
    const p = d.defs[d.parts.find((x) => x.id === part)!.def]!.symbol.pins.find((x) => x.number === pin)!;
    return [sym.x + p.x, sym.y + p.y];
  };
  for (const [n, row] of [
    ["1", 6 * G],
    ["2", -6 * G],
  ] as const) {
    const a = at(r.part.id, n);
    const b = at(j.part.id, n);
    d = addWire(d, "sh1", a, [a[0], row]);
    d = addWire(d, "sh1", [a[0], row], [b[0], row]);
    d = addWire(d, "sh1", [b[0], row], b);
  }
  d = pushToBoard(d).design;
  d = setPlacement(d, r.part.id, { x: 10, y: 20 });
  d = setPlacement(d, j.part.id, { x: 30, y: 20 });
  const pad = (ref: string, n: string) => boardPads(d).find((p) => p.ref === ref && p.pad.number === n)!.at;
  return { d, pad };
}

const rulesOf = (d: ElectronicsDesign): BoardRuleId[] => checkBoard(d).map((r) => r.rule);

describe("copper as shapes", () => {
  it("measures the gap between tracks, vias and pads", () => {
    expect(gap({ pts: [[0, 0]], r: 0.5 }, { pts: [[2, 0]], r: 0.5 })).toBeCloseTo(1, 6);
    expect(
      gap(
        {
          pts: [
            [0, 0],
            [10, 0],
          ],
          r: 0.125,
        },
        {
          pts: [
            [5, 1],
            [5, 5],
          ],
          r: 0.125,
        },
      ),
    ).toBeCloseTo(0.75, 6);
    // Crossing, and one inside the other: touching.
    expect(
      gap(
        {
          pts: [
            [0, 0],
            [10, 0],
          ],
          r: 0.1,
        },
        {
          pts: [
            [5, -1],
            [5, 1],
          ],
          r: 0.1,
        },
      ),
    ).toBe(0);
    const square = {
      pts: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ] as P2[],
      r: 0,
    };
    expect(gap(square, { pts: [[2, 2]], r: 0.1 })).toBe(0);
    expect(gap(square, { pts: [[6, 2]], r: 0.5 })).toBeCloseTo(1.5, 6);
  });

  it("gives a pad the shape it has, turned with its part", () => {
    const { d } = netted();
    for (const p of boardPads(d)) {
      const s = padSolid(p);
      expect(gap(s, { pts: [p.at], r: 0 })).toBe(0);
    }
    expect(copperOf(d).filter((c) => c.kind === "pad")).toHaveLength(4);
  });

  it("measures to the board's edge, and knows off the board from on it", () => {
    const loops = edgeLoops({ outline: roundedOutline(50, 40, 0) });
    expect(edgeGap({ pts: [[1, 20]], r: 0.3 }, loops)).toBeCloseTo(0.7, 6);
    expect(edgeGap({ pts: [[-2, 20]], r: 0.3 }, loops)).toBeLessThan(0);
    const round = roundedOutline(50, 40, 5);
    expect(outlineRadius(round)).toBe(5);
    expect(outlineRadius(roundedOutline(50, 40))).toBe(0);
    // The rounded corner is cut away.
    expect(edgeGap({ pts: [[0.5, 0.5]], r: 0 }, edgeLoops({ outline: round }))).toBeLessThan(0);
  });
});

describe("routing", () => {
  it("bends once at 45°", () => {
    expect(corner45([0, 0], [10, 4])).toEqual([
      [0, 0],
      [6, 0],
      [10, 4],
    ]);
    expect(corner45([0, 0], [10, 4], true)).toEqual([
      [0, 0],
      [4, 4],
      [10, 4],
    ]);
    expect(corner45([0, 0], [3, 9])).toEqual([
      [0, 0],
      [0, 6],
      [3, 9],
    ]);
    expect(corner45([0, 0], [5, 5])).toEqual([
      [0, 0],
      [5, 5],
    ]);
    expect(corner45([0, 0], [0, 7])).toHaveLength(2);
    expect(
      tidyRun([
        [0, 0],
        [1, 0],
        [1, 0],
        [3, 0],
        [3, 2],
      ]),
    ).toEqual([
      [0, 0],
      [3, 0],
      [3, 2],
    ]);
  });

  it("joins pads with tracks and a via, and the ratsnest follows", () => {
    const { d, pad } = netted();
    const net = boardPads(d).find((p) => p.ref === "R1" && p.pad.number === "1")!.net;
    const left = (x: ElectronicsDesign) => {
      const s = boardState(x);
      return ratsnest(s.pads, s.joined).length;
    };
    expect(left(d)).toBe(2);
    const a = pad("R1", "1");
    const b = pad("J1", "1");
    const mid: P2 = [(a[0] + b[0]) / 2, a[1] + 3];
    // Top to the middle, a via, then the bottom layer to the header's through-hole pad.
    let routed = addTrack(d, net, "top", [a, mid]);
    expect(left(routed)).toBe(2);
    routed = addTrack(routed, net, "bottom", [mid, b]);
    expect(left(routed)).toBe(2);
    routed = addVia(routed, net, mid[0], mid[1]);
    expect(addVia(routed, net, mid[0], mid[1])).toBe(routed);
    expect(routed.board!.vias).toHaveLength(1);
    expect(left(routed)).toBe(1);
    expect(routed.board!.tracks[0]!.width).toBe(netRules(routed.board!, net).trackWidth);
    expect(left(ripUpNet(routed, net))).toBe(2);
    // Clear routes takes every track and via off, and leaves the parts where they are.
    const cleared = clearRoutes(routed);
    expect(cleared.board!.tracks).toEqual([]);
    expect(cleared.board!.vias).toEqual([]);
    expect(cleared.board!.placements).toBe(routed.board!.placements);
    expect(left(cleared)).toBe(2);
    expect(clearRoutes(cleared)).toBe(cleared);
  });

  it("says what a new track would come too close to", () => {
    const { d, pad } = netted();
    const s = boardState(d);
    const loops = edgeLoops(d.board!);
    const other = pad("J1", "2");
    const net = s.pads.find((p) => p.ref === "J1" && p.pad.number === "1")!.net;
    const hit = blockers(d.board!, s.copper, loops, { net, layers: ["top"], pts: [[other[0] - 5, other[1]], other], width: 0.25 });
    expect(hit.map((h) => h.what)).toContain("J1 pad 2");
    expect(hit[0]!.gap).toBe(0);
    // Its own net is never in its way, and nor is copper on the other side... a through-hole pad is on both.
    expect(
      blockers(d.board!, s.copper, loops, {
        net: s.pads.find((p) => p.ref === "J1" && p.pad.number === "2")!.net,
        layers: ["top"],
        pts: [[other[0] - 5, other[1]], other],
        width: 0.25,
      }).map((h) => h.what),
    ).not.toContain("J1 pad 2");
    expect(
      blockers(d.board!, s.copper, loops, {
        net,
        layers: ["top"],
        pts: [
          [0.1, 5],
          [0.1, 9],
        ],
        width: 0.25,
      }).map((h) => h.what),
    ).toEqual(["the board's edge"]);
  });
});

describe("placing", () => {
  it("sets a part down by numbers, locks it and lines parts up", () => {
    let d = netted().d;
    const [j, r] = d.board!.placements.map((p) => p.part) as [string, string];
    const at = (x: ElectronicsDesign, part: string) => x.board!.placements.find((p) => p.part === part)!;
    d = setPlacement(d, r, { x: 12.5, y: 7, rot: 450, side: "bottom" });
    expect(at(d, r)).toMatchObject({ x: 12.5, y: 7, rot: 90, side: "bottom" });
    d = alignParts(d, [r, j], "top");
    expect(d.board!.placements.map((p) => p.y)).toEqual([20, 20]);
    d = toggleLock(d, [r]);
    expect(at(d, r).locked).toBe(true);
    expect(at(alignParts(d, [r, j], "left"), j).x).toBe(12.5);
    // A locked part stays where it is.
    expect(at(alignParts(d, [r, j], "right"), r).x).toBe(12.5);
    expect(at(toggleLock(d, [r]), r).locked).toBeUndefined();
  });
});

describe("the design rule check", () => {
  it("finds a clean routed board clean", () => {
    const { d, pad } = netted();
    let routed = d;
    for (const n of ["1", "2"]) {
      const net = boardPads(d).find((p) => p.ref === "R1" && p.pad.number === n)!.net;
      const a = pad("R1", n);
      const b = pad("J1", n);
      const up = n === "1" ? 4 : -4;
      routed = addTrack(routed, net, "top", [a, [a[0], a[1] + up], [b[0], a[1] + up], b]);
    }
    expect(checkBoard(routed)).toEqual([]);
    expect(rulesOf(d)).toEqual(["unrouted", "unrouted"]);
  });

  it("finds shorts, tight gaps and copper at the edge", () => {
    const { d, pad } = netted();
    const one = boardPads(d).find((p) => p.ref === "J1" && p.pad.number === "1")!;
    const two = pad("J1", "2");
    // A track of net 1 run straight over pad 2.
    const short = addTrack(d, one.net, "top", [one.at, two]);
    const found = checkBoard(short).find((r) => r.rule === "short")!;
    expect(found.text).toMatch(/J1 pad 2 touches a track on|A track on .* touches J1 pad 2/);
    expect(found.board).toBe(true);
    // A track 0.1 mm from pad 2's copper.
    const s = padSolid(boardPads(d).find((p) => p.ref === "J1" && p.pad.number === "2")!);
    const reach = Math.max(...s.pts.map((p) => p[0])) + s.r;
    const x = reach + 0.1 + 0.125;
    const tight = checkBoard(
      addTrack(d, one.net, "top", [
        [x, two[1] - 3],
        [x, two[1] + 3],
      ]),
    ).find((r) => r.rule === "clearance")!;
    expect(tight.text).toContain("0.1 mm apart. The rules ask for 0.2 mm.");
    const edge = checkBoard(
      addTrack(d, one.net, "top", [
        [0.2, 5],
        [0.2, 9],
      ]),
    ).find((r) => r.rule === "edge")!;
    expect(edge.text).toContain("0.075 mm from the board's edge");
    expect(
      checkBoard(
        addTrack(d, one.net, "top", [
          [-1, 5],
          [3, 5],
        ]),
      ).find((r) => r.rule === "edge")!.text,
    ).toContain("over the board's edge");
  });

  it("finds tracks, vias and holes the board house could not make", () => {
    const { d } = netted();
    let bad = addTrack(
      d,
      "",
      "top",
      [
        [5, 5],
        [8, 5],
      ],
      0.1,
    );
    bad = { ...bad, board: { ...bad.board!, vias: [{ id: "v1", net: "", x: 20, y: 5, diameter: 0.4, drill: 0.2 }] } };
    bad = addHole(addHole(bad, 40, 5, 3.2), 43.4, 5, 3.2, 3.3);
    bad = addText(bad, 5, 35, "v1", "silk-top", 0.6);
    const found = checkBoard(bad);
    expect(found.filter((r) => r.rule === "track-width")).toHaveLength(1);
    expect(found.filter((r) => r.rule === "hole-size").map((r) => r.text)).toEqual([
      "A via on no net has a 0.2 mm hole. The smallest the rules allow is 0.3 mm.",
    ]);
    expect(found.filter((r) => r.rule === "ring")).toHaveLength(2);
    expect(found.find((r) => r.rule === "hole-near")!.text).toContain("0.2 mm apart");
    expect(found.find((r) => r.rule === "silk-size")!.level).toBe("warning");
    expect(found.filter((r) => r.rule === "track-open")).toHaveLength(2);
  });

  it("finds parts off the board, on top of each other and in keep-outs", () => {
    const { d } = netted();
    const [j, r] = d.board!.placements.map((p) => p.part) as [string, string];
    expect(
      checkBoard(setPlacement(d, r, { x: 80, y: 20 }))
        .filter((x) => x.rule === "off-board")
        .map((x) => x.text),
    ).toEqual(["R1 is off the board."]);
    expect(checkBoard(setPlacement(d, r, { x: 30, y: 20 })).find((x) => x.rule === "courtyard")).toMatchObject({
      text: "J1 and R1 overlap.",
      level: "warning",
      parts: [j, r],
    });
    // On opposite sides they do not clash.
    expect(rulesOf(setPlacement(d, r, { x: 30, y: 20, side: "bottom" }))).not.toContain("courtyard");
    const kept = addKeepout(d, [5, 15], [15, 25], { parts: true, tracks: true });
    expect(checkBoard(kept).find((x) => x.rule === "keepout")!.text).toBe("R1 is in a keep-out.");
    expect(
      checkBoard(
        addTrack(kept, "", "top", [
          [6, 16],
          [9, 16],
        ]),
      ).filter((x) => x.rule === "keepout"),
    ).toHaveLength(2);
  });

  it("says when the board is behind the schematic or holds copper for a net that is gone", () => {
    const { d } = netted();
    const more = placePart(d, "sh1", resistor(), { x: 0, y: 30 * G }).design;
    expect(checkBoard(more).find((r) => r.rule === "behind")!.text).toBe("The board is behind the schematic by 1 change.");
    expect(
      checkBoard(
        addTrack(d, "OLD", "top", [
          [5, 5],
          [8, 5],
        ]),
      ).find((r) => r.rule === "dead-net")!.text,
    ).toContain("OLD");
  });

  it("keeps its levels and waivers apart from the schematic's", () => {
    const { d } = netted();
    const first = checkBoard(d)[0]!;
    let w = waiveBoard(d, first.key, "Routed by hand later");
    expect(checkBoard(w).find((r) => r.key === first.key)!.waived).toBe("Routed by hand later");
    // A schematic waiver does not throw the board's away, and the other way round.
    const sch = check(w)[0];
    if (sch) {
      w = waive(w, sch.key, "Fine");
      expect(w.checks!.waived![first.key]).toBe("Routed by hand later");
      w = waiveBoard(w, first.key);
      expect(w.checks!.waived![sch.key]).toBe("Fine");
    }
    expect(new Set(BOARD_RULES.map((r) => r.id)).size).toBe(BOARD_RULES.length);
    const quiet = { ...d, checks: { levels: { unrouted: "ignore" as const } } };
    expect(checkBoard(quiet)).toEqual([]);
  });
});

describe("placing, checked as you go", () => {
  it("says what is wrong with where a part sits while it is moved, for that part alone (#639)", () => {
    const { d } = netted();
    const [j, r] = d.board!.placements.map((p) => p.part) as [string, string];
    expect(placeClashes(d, [r])).toEqual([]);
    expect(placeClashes(setPlacement(d, r, { x: 80, y: 20 }), [r])).toEqual([{ parts: [r], text: "R1 is off the board." }]);
    const over = setPlacement(d, r, { x: 30, y: 20 });
    expect(placeClashes(over, [r])).toEqual([{ parts: [r, j], text: "R1 and J1 overlap." }]);
    // Both picked: said once. Neither picked: nothing to say.
    expect(placeClashes(over, [r, j])).toEqual([{ parts: [j, r], text: "J1 and R1 overlap." }]);
    expect(placeClashes(over, [])).toEqual([]);
    expect(placeClashes(setPlacement(d, r, { x: 30, y: 20, side: "bottom" }), [r])).toEqual([]);
    expect(placeClashes(addKeepout(d, [5, 15], [15, 25], { parts: true, tracks: true }), [r]).map((c) => c.text)).toEqual(["R1 is in a keep-out."]);
    expect(placeClashes(setPlacement(d, r, { x: 0.5, y: 20 }), [r]).map((c) => c.text)).toEqual(["R1 hangs over the board's edge."]);
  });
});

describe("rule presets", () => {
  it("says where each board house's numbers came from", () => {
    for (const p of PRESETS.filter((x) => x.id !== "safe")) {
      expect(p.source).toMatch(/^https:\/\//);
      expect(p.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.rules.minTrackWidth).toBeLessThanOrEqual(p.rules.trackWidth);
      expect(p.rules.viaDrill).toBeGreaterThanOrEqual(p.rules.minDrill);
      expect((p.rules.viaDiameter - p.rules.viaDrill) / 2).toBeGreaterThanOrEqual(p.rules.minViaRing ?? p.rules.minRing);
    }
  });

  it("swaps the board's rules for a preset and notices a change", () => {
    const { d } = netted();
    expect(matchesPreset(d.board!.rules)).toBe(true);
    const jlc = applyPreset(d, "jlcpcb-2layer");
    expect(jlc.board!.rules).toMatchObject({ preset: "jlcpcb-2layer", minTrackWidth: 0.1 });
    expect(matchesPreset(jlc.board!.rules)).toBe(true);
    const own = setRule(jlc, "clearance", 0.3);
    expect(matchesPreset(own.board!.rules)).toBe(false);
    expect(setRule(jlc, "clearance", -1)).toBe(jlc);
    expect(applyPreset(jlc, "safe").board!.rules.preset).toBeUndefined();
    expect(applyPreset(jlc, "safe").board!.rules.presetChecked).toBeUndefined();
    // The day the limits were checked is kept, so numbers checked again later are offered and never applied.
    const day = PRESETS.find((p) => p.id === "jlcpcb-2layer")!.checked!;
    expect(jlc.board!.rules.presetChecked).toBe(day);
    expect(presetChanges(jlc.board!.rules)).toBeNull();
    expect(presetChanges({ ...own.board!.rules })).toBeNull();
    const older = { ...own.board!.rules, presetChecked: "2020-01-01" };
    expect(presetChanges(older)).toMatchObject({
      preset: { id: "jlcpcb-2layer" },
      fields: [{ id: "clearance", label: "Clearance", yours: 0.3, theirs: jlc.board!.rules.clearance }],
    });
    expect(presetChanges({ ...jlc.board!.rules, presetChecked: "2020-01-01" })).toBeNull();
    const kept = keepRules({ ...own, board: { ...own.board!, rules: older } });
    expect(kept.board!.rules).toMatchObject({ clearance: 0.3, presetChecked: day });
    expect(setBoard(d, { thickness: 1 }).board!.thickness).toBe(1);
  });
});

describe("copper pours", () => {
  /** A pour over the whole board on the net of pin 1, top side. */
  const poured = (thermal = true) => {
    const { d, pad } = netted();
    const net = boardPads(d).find((p) => p.ref === "R1" && p.pad.number === "1")!.net;
    const other = boardPads(d).find((p) => p.ref === "R1" && p.pad.number === "2")!.net;
    return { d: addPour(d, net, "top", wholeBoard(d.board!), thermal), net, other, pad };
  };
  const cell = (f: PourFill, p: P2) => f.cells[Math.round((p[1] - f.y0) / f.step) * f.w + Math.round((p[0] - f.x0) / f.step)]!;
  const left = (d: ElectronicsDesign) => {
    const s = boardState(d);
    return ratsnest(s.pads, s.joined).length;
  };

  it("fills the board, back from the edge and round the other net", () => {
    const { d, pad } = poured();
    const f = pourFill(d, d.board!.pours[0]!);
    expect(f.step).toBeCloseTo(0.1, 6);
    expect(f.area).toBeGreaterThan(50 * 40 * 0.9);
    expect(f.area).toBeLessThan(50 * 40);
    expect(cell(f, [25, 5])).toBeGreaterThan(0);
    // Bare board inside the edge clearance, and on and round the other net's pad.
    expect(cell(f, [0.15, 20])).toBe(0);
    expect(cell(f, [0.6, 20])).toBeGreaterThan(0);
    const two = pad("J1", "2");
    expect(cell(f, two)).toBe(0);
    expect(cell(f, [two[0] + 1.05, two[1]])).toBe(0);
    expect(f.islands).toEqual([]);
  });

  it("joins its own pads, so they need no track", () => {
    const { d } = poured();
    expect(left(netted().d)).toBe(2);
    expect(left(d)).toBe(1);
    const found = checkBoard(d).filter((r) => r.rule === "unrouted");
    expect(found).toHaveLength(1);
  });

  it("reaches a pad through spokes, or all round it when the pour is solid", () => {
    const { d, pad } = poured();
    const one = boardPads(d).find((p) => p.ref === "J1" && p.pad.number === "1")!;
    // In the gap round the pad: beside a spoke, and on one.
    const out = Math.max(one.pad.w, one.pad.h) / 2 + 0.15;
    const diagonal: P2 = [one.at[0] + out, one.at[1] + 0.6];
    const along: P2 = [one.at[0], one.at[1] + out];
    const spoked = pourFill(d, d.board!.pours[0]!);
    expect(pourShape(d, d.board!.pours[0]!).spokes.length).toBeGreaterThanOrEqual(8);
    expect(cell(spoked, along)).toBeGreaterThan(0);
    expect(cell(spoked, diagonal)).toBe(0);
    const solid = setPour(d, d.board!.pours[0]!.id, { thermal: false });
    expect(pourShape(solid, solid.board!.pours[0]!).spokes).toEqual([]);
    expect(cell(pourFill(solid, solid.board!.pours[0]!), diagonal)).toBeGreaterThan(0);
    expect(pad("J1", "1")).toEqual(one.at);
    // One pad can go its own way (#641): joined all round in a pour that uses spokes, and the other way about.
    const own = setPadJoin(d, one.part, "1", "solid");
    expect(own.board!.placements.find((p) => p.part === one.part)!.joins).toEqual({ "1": "solid" });
    expect(cell(pourFill(own, own.board!.pours[0]!), diagonal)).toBeGreaterThan(0);
    expect(pourShape(own, own.board!.pours[0]!).spokes.length).toBe(pourShape(d, d.board!.pours[0]!).spokes.length - 4);
    const spokesIn = setPadJoin(solid, one.part, "1", "spokes");
    expect(pourShape(spokesIn, spokesIn.board!.pours[0]!).spokes).toHaveLength(4);
    expect(cell(pourFill(spokesIn, spokesIn.board!.pours[0]!), diagonal)).toBe(0);
    // Back to the pour's way, and the note is gone.
    expect(setPadJoin(own, one.part, "1").board!.placements.find((p) => p.part === one.part)).not.toHaveProperty("joins");
  });

  it("is cut in two by a track right across it, and drops a piece that reaches nothing", () => {
    const { d, other } = poured();
    // A wall of the other net from edge to edge between the two parts: each side keeps its own pad.
    const wall = addTrack(d, other, "top", [
      [20, 0.5],
      [20, 39.5],
    ]);
    const f = pourFill(wall, wall.board!.pours[0]!);
    expect(f.joins.filter((j) => j.length)).toHaveLength(2);
    expect(left(wall)).toBe(2);
    // A fence round an empty patch leaves an island there, which is dropped.
    const fence = addTrack(d, other, "top", [
      [40, 30],
      [46, 30],
      [46, 36],
      [40, 36],
      [40, 30],
    ]);
    const g = pourFill(fence, fence.board!.pours[0]!);
    expect(g.islands.length).toBeGreaterThan(0);
    expect(cell(g, [43, 33])).toBe(0);
    expect(cell(g, [25, 5])).toBeGreaterThan(0);
  });

  it("stays out of keep-outs and cut-outs, and gives way to a pour that fills first", () => {
    const { d, other } = poured();
    const area: P2[] = [
      [35, 2],
      [45, 2],
      [45, 10],
      [35, 10],
    ];
    const kept = addKeepoutArea(d, area);
    expect(cell(pourFill(kept, kept.board!.pours[0]!), [40, 6])).toBe(0);
    const cut = addCutout(d, area);
    expect(cell(pourFill(cut, cut.board!.pours[0]!), [40, 6])).toBe(0);
    expect(cell(pourFill(cut, cut.board!.pours[0]!), [34.8, 6])).toBe(0);
    expect(removeAreas(cut, ["cut:0"]).board!.cutouts).toBeUndefined();
    expect(removeAreas(kept, [kept.board!.keepouts[0]!.id]).board!.keepouts).toEqual([]);
    // A second pour on the other net, over the same patch, with a higher priority.
    let both = addPour(d, other, "top", area);
    both = setPour(both, both.board!.pours[1]!.id, { priority: 1 });
    expect(cell(pourFill(both, both.board!.pours[0]!), [40, 6])).toBe(0);
    expect(cell(pourFill(both, both.board!.pours[0]!), [34.9, 6])).toBe(0);
    expect(cell(pourFill(both, both.board!.pours[0]!), [34.5, 6])).toBeGreaterThan(0);
  });

  it("says when a pour fills nothing", () => {
    const { d } = netted();
    const empty = addPour(d, "NOWHERE", "bottom", [
      [35, 2],
      [45, 2],
      [45, 10],
      [35, 10],
    ]);
    expect(checkBoard(empty).find((r) => r.rule === "pour-empty")!.text).toBe("The pour on NOWHERE fills nothing.");
    expect(
      addPour(d, "GND", "top", [
        [0, 0],
        [1, 1],
      ]),
    ).toBe(d);
  });
});

describe("back to the schematic", () => {
  it("deletes a part from the board and the sheet in one change", () => {
    const { d } = netted();
    const r1 = d.parts.find((p) => p.ref === "R1")!;
    const gone = deleteParts(d, [r1.id]);
    expect(gone.parts.map((p) => p.ref)).toEqual(["J1"]);
    expect(gone.board!.placements.map((p) => p.part)).toEqual([d.parts.find((p) => p.ref === "J1")!.id]);
    expect(gone.sheets[0]!.symbols.some((s) => s.part === r1.id)).toBe(false);
    expect(deleteParts(d, ["nothing"])).toBe(d);
  });

  it("swaps two pins where the component says they do the same job, and the schematic follows (#645)", () => {
    const { d } = netted();
    const r1 = d.parts.find((p) => p.ref === "R1")!;
    const j1 = d.parts.find((p) => p.ref === "J1")!;
    // A resistor's two ends can swap. A header's pins cannot.
    expect(swapGroups(d, r1.id)).toEqual([["1", "2"]]);
    expect(swapGroups(d, j1.id)).toEqual([]);
    expect(swapPins(d, j1.id, "1", "2")).toBe(d);
    const pinsOn = (x: ElectronicsDesign) =>
      netlist(x)
        .nets.map((n) =>
          n.pins
            .map((p) => `${p.ref}.${p.pin}`)
            .sort()
            .join(" "),
        )
        .sort();
    expect(pinsOn(d)).toEqual(["J1.1 R1.1", "J1.2 R1.2"]);
    const padNet = (x: ElectronicsDesign, n: string) => boardPads(x).find((p) => p.ref === "R1" && p.pad.number === n)!.net;
    const before = [padNet(d, "1"), padNet(d, "2")];
    const swapped = swapPins(d, r1.id, "1", "2");
    // The wires have not moved; they reach the other pin now, and the pads have each other's nets.
    expect(swapped.sheets).toBe(d.sheets);
    expect(pinsOn(swapped)).toEqual(["J1.1 R1.2", "J1.2 R1.1"]);
    expect([padNet(swapped, "1"), padNet(swapped, "2")]).toEqual([before[1], before[0]]);
    // Only R1 changed: it has a copy of its own, marked as swapped.
    const mine = swapped.parts.find((p) => p.id === r1.id)!;
    expect(mine.def).not.toBe(r1.def);
    expect(swapped.defs[mine.def]!.swapped).toBe(true);
    expect(swapped.defs[r1.def]).toBe(d.defs[r1.def]);
    expect(pinsOn(swapPins(swapped, r1.id, "2", "1"))).toEqual(pinsOn(d));
  });

  it("numbers parts by where they sit on the board, and the schematic follows", () => {
    let d = emptyDesign();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = placePart(d, "sh1", resistor(), { x: i * 10 * G, y: 0 });
      d = r.design;
      ids.push(r.part.id);
    }
    d = pushToBoard(d).design;
    // R1 goes bottom right, R2 top right, R3 top left: R3 is now the first you come to.
    d = setPlacement(d, ids[0]!, { x: 40, y: 5 });
    d = setPlacement(d, ids[1]!, { x: 40, y: 30 });
    d = setPlacement(d, ids[2]!, { x: 10, y: 30.4 });
    const next = renumberOnBoard(d);
    const ref = (id: string) => next.parts.find((p) => p.id === id)!.ref;
    expect(ids.map(ref)).toEqual(["R3", "R2", "R1"]);
    expect(next.board!.placements.find((p) => p.part === ids[2])!.ref).toBe("R1");
    expect(renumberOnBoard(next)).toBe(next);
    // The bottom side is numbered after the top.
    const flipped = renumberOnBoard(setPlacement(next, ids[2]!, { side: "bottom" }));
    expect(flipped.parts.find((p) => p.id === ids[2])!.ref).toBe("R3");
  });
});

describe("an outline from a sketch", () => {
  const l: P2[] = [
    [100, 50],
    [130, 50],
    [140, 50],
    [140, 70],
    [120, 70],
    [120, 90],
    [100, 90],
  ];
  const slot: P2[] = [
    [105, 55],
    [110, 55],
    [110, 60],
    [105, 60],
  ];

  it("takes the shape, moves it to the board's corner and drops points on a straight run", () => {
    const o = outlineOf({ outer: l, holes: [slot] });
    expect(o.outline).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 40 },
      { x: 0, y: 40 },
    ]);
    expect(o.cutouts).toEqual([
      [
        { x: 5, y: 5 },
        { x: 10, y: 5 },
        { x: 10, y: 10 },
        { x: 5, y: 10 },
      ],
    ]);
  });

  it("follows the sketch, says when it has changed, and lets go", () => {
    const { d } = netted();
    const made = followSketch(d, "sk1", { outer: l, holes: [slot] });
    expect(made.board!.outlineFrom).toEqual({ sketch: "sk1", at: [100, 50] });
    expect(made.board!.outline).toHaveLength(6);
    expect(made.board!.cutouts).toHaveLength(1);
    expect(outlineBehind(made.board!, { outer: l, holes: [slot] })).toBe(false);
    // The sketch moving does not count; its shape changing does.
    expect(outlineBehind(made.board!, { outer: l.map(([x, y]) => [x + 7, y - 3] as P2), holes: [slot.map(([x, y]) => [x + 7, y - 3] as P2)] })).toBe(false);
    expect(outlineBehind(made.board!, { outer: l, holes: [] })).toBe(true);
    const plain = followSketch(made, "sk1", { outer: l, holes: [] });
    expect(plain.board!.cutouts).toBeUndefined();
    const free = unfollowSketch(plain);
    expect(free.board!.outlineFrom).toBeUndefined();
    expect(free.board!.outline).toEqual(plain.board!.outline);
    // A part in the cut-out is off the board.
    const r1 = made.parts.find((p) => p.ref === "R1")!;
    expect(rulesOf(setPlacement(made, r1.id, { x: 30, y: 30 }))).toContain("off-board");
  });
});
