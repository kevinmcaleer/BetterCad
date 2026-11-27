import { describe, expect, it } from "vitest";
import { addPour, pourFill, setPour, wholeBoard } from "../pcb/pour";
import { addTrack, setBoard, setVia } from "../pcb/route";
import { fabBoard } from "./fixture";
import { GERBER_LAYERS, gerberFiles, type GerberLayer } from "./gerber";
import { boardPads, pointInPolygon } from "../board";
import { distToSegment } from "../geom";
import { clearanceBetween, copperOf } from "../pcb/copper";
import type { ElectronicsDesign, P2, Pad, Pour } from "../model";
import { inkAt, readGerber, type GerberImage } from "./read";

const files = () => {
  const { d, pad, nets } = fabBoard();
  const out = gerberFiles(d);
  const image = (layer: GerberLayer) => readGerber(out.find((f) => f.layer === layer)!.text);
  return { d, pad, nets, out, image };
};

describe("Gerber files", () => {
  it("writes one file per layer, each saying what it is", () => {
    const { out } = files();
    expect(out.map((f) => f.layer)).toEqual(GERBER_LAYERS.map((l) => l.id));
    for (const f of out) {
      expect(f.text.startsWith("%TF.GenerationSoftware,BetterCad")).toBe(true);
      expect(f.text).toContain(`%TF.FileFunction,${f.fn}*%`);
      expect(f.text).toContain("%FSLAX46Y46*%\n%MOMM*%");
      expect(f.text.trimEnd().endsWith("M02*")).toBe(true);
      expect(readGerber(f.text).fn).toBe(f.fn);
      expect(readGerber(f.text).skipped).toEqual([]);
    }
  });

  it("matches the golden files", async () => {
    for (const f of files().out) await expect(f.text).toMatchFileSnapshot(`./golden/fab-board.${f.layer}.gbr`);
  });

  it("flashes pads with apertures: a macro for a turned, rounded pad, and plain shapes for the rest", () => {
    const { out, image, pad } = files();
    const top = out.find((f) => f.layer === "copper-top")!.text;
    // R1's pads are rounded rectangles at 30°: one macro of two bars and four discs, flashed twice.
    expect(top).toMatch(/%AMM1\*\n21,1,[\d.]+,[\d.]+,0,0,30\*\n21,1,[\d.]+,[\d.]+,0,0,30\*\n(1,1,[-\d.,]+\*\n){4}%/);
    expect(top).toContain("%TA.AperFunction,SMDPad,CuDef*%");
    // J1: a square pad for pin 1 and a round one for pin 2.
    expect(top).toMatch(/%ADD\d+R,1\.7X1\.7\*%/);
    expect(top).toMatch(/%ADD\d+C,1\.7\*%/);
    expect(top).toContain("%TO.P,R1,1*%");
    const copper = image("copper-top");
    expect(copper.ops.filter((o) => o.kind === "flash")).toHaveLength(6);
    for (const [ref, n] of [
      ["R1", "1"],
      ["R1", "2"],
      ["J1", "1"],
      ["J1", "2"],
    ] as const)
      expect(inkAt(copper, pad(ref, n)), `${ref} pad ${n}`).toBe(true);
    // Surface pads are on their own side only; through pads are on both.
    const bottom = image("copper-bottom");
    expect(bottom.ops.filter((o) => o.kind === "flash" && o.dark && o.at[1] === pad("J1", "1")[1] && o.at[0] === 30)).toHaveLength(1);
    expect(bottom.ops.filter((o) => o.kind === "flash" && o.dark && o.at[0] === pad("R1", "1")[0])).toHaveLength(0);
  });

  it("draws tracks with a round pen and names their net", () => {
    const { out, image, nets } = files();
    const top = out.find((f) => f.layer === "copper-top")!.text;
    expect(top).toContain("%TA.AperFunction,Conductor*%\n%ADD");
    expect(top).toContain(`%TO.N,${nets[0]}*%`);
    const copper = image("copper-top");
    expect(inkAt(copper, [15, 30])).toBe(true);
    expect(inkAt(copper, [15, 30.12])).toBe(true);
    expect(inkAt(copper, [15, 30.2])).toBe(false);
    // The via is on both sides.
    expect(inkAt(copper, [20.3, 30])).toBe(true);
    expect(inkAt(image("copper-bottom"), [20.3, 30.1])).toBe(true);
  });

  it("paints a pour as an area with what it keeps clear of taken out, and spokes to its own pads", () => {
    const { image, pad, d, nets } = files();
    const bottom = image("copper-bottom");
    // Open board, away from everything: copper.
    expect(inkAt(bottom, [40, 12])).toBe(true);
    // It stays back from the edge, the slot, the bare hole and the other net's track.
    expect(inkAt(bottom, [0.1, 20])).toBe(false);
    expect(inkAt(bottom, [0.5, 20])).toBe(true);
    expect(inkAt(bottom, [25, 6.5])).toBe(false);
    expect(inkAt(bottom, [25, 8.2])).toBe(false);
    expect(inkAt(bottom, [45, 35])).toBe(false);
    expect(inkAt(bottom, [45, 33.2])).toBe(false);
    const gapBy = d.board!.rules.clearance;
    expect(inkAt(bottom, [25, 30 + 0.125 + gapBy - 0.02])).toBe(false);
    expect(inkAt(bottom, [25, 30 + 0.125 + gapBy + 0.02])).toBe(true);
    expect(inkAt(bottom, [25, 30])).toBe(true);
    // Nothing is left outside the board, not even in a rounded corner.
    expect(inkAt(bottom, [0.3, 0.3])).toBe(false);
    expect(inkAt(bottom, [-1, 20])).toBe(false);
    // Its own pad, J1 pin 2: a ring of bare board, crossed by spokes.
    const p = pad("J1", "2");
    expect(nets[1]).toBeTruthy();
    expect(inkAt(bottom, p)).toBe(true);
    expect(inkAt(bottom, [p[0] + 0.85 + 0.15, p[1]])).toBe(true);
    const a = Math.PI / 4;
    expect(inkAt(bottom, [p[0] + 1 * Math.cos(a), p[1] + 1 * Math.sin(a)])).toBe(false);
    expect(inkAt(bottom, [p[0] + 1.6 * Math.cos(a), p[1] + 1.6 * Math.sin(a)])).toBe(true);
  });

  it("opens the mask over pads and holes, a little bigger than the copper, and leaves vias covered", () => {
    const { image, pad } = files();
    const mask = image("mask-top");
    const j = pad("J1", "1");
    expect(inkAt(mask, [j[0] + 0.85 + 0.04, j[1]])).toBe(true);
    expect(inkAt(mask, [j[0] + 0.85 + 0.06, j[1]])).toBe(false);
    expect(inkAt(mask, [20, 30])).toBe(false);
    expect(inkAt(mask, [45, 35])).toBe(true);
    expect(inkAt(mask, [5, 35.95])).toBe(true);
    // R1 is on top: no opening for it on the bottom.
    expect(inkAt(image("mask-bottom"), pad("R1", "1"))).toBe(false);
    expect(inkAt(image("mask-bottom"), j)).toBe(true);
  });

  it("opens the mask over vias when the board says so, unless a via says otherwise (#736)", () => {
    const { d } = files();
    const via = d.board!.vias[0]!;
    const at: [number, number] = [via.x, via.y];
    const masks = (x: ElectronicsDesign) => {
      const out = gerberFiles(x);
      return (["mask-top", "mask-bottom", "silk-top"] as const).map((l) => inkAt(readGerber(out.find((f) => f.layer === l)!.text), at));
    };
    expect(masks(d)).toEqual([false, false, false]);
    const open = setBoard(d, { viaMask: "open" });
    // Open on both sides, and the silkscreen keeps off it as it does off a pad.
    expect(masks(open).slice(0, 2)).toEqual([true, true]);
    const one = setVia(open, via.id, { mask: "covered" });
    expect(one.board!.vias[0]!.mask).toBe("covered");
    expect(masks(one)).toEqual([false, false, false]);
    // A via that says what the board says keeps nothing of its own.
    expect(setVia(one, via.id, { mask: "open" }).board!.vias[0]).not.toHaveProperty("mask");
    expect(masks(setVia(d, via.id, { mask: "open" })).slice(0, 2)).toEqual([true, true]);
  });

  it("puts paste on surface pads only", () => {
    const { image, pad } = files();
    expect(image("paste-top").ops).toHaveLength(2);
    expect(inkAt(image("paste-top"), pad("R1", "2"))).toBe(true);
    expect(image("paste-bottom").ops).toHaveLength(0);
  });

  it("gives a pad its own paste opening, or none", () => {
    const { d, pad } = fabBoard();
    const r1 = d.defs[d.parts.find((p) => p.ref === "R1")!.def]!;
    const edit = (change: (p: Pad) => Pad): ElectronicsDesign => ({
      ...d,
      defs: {
        ...d.defs,
        [d.parts.find((p) => p.ref === "R1")!.def]: {
          ...r1,
          packages: r1.packages.map((k) => ({ ...k, footprint: { ...k.footprint, pads: k.footprint.pads.map((p) => (p.number === "2" ? change(p) : p)) } })),
        },
      },
    });
    const paste = (design: ElectronicsDesign) => readGerber(gerberFiles(design).find((f) => f.layer === "paste-top")!.text);
    const w = r1.packages[0]!.footprint.pads[0]!.w;
    const h = r1.packages[0]!.footprint.pads[0]!.h;
    const span = (i: GerberImage) => (i.box!.x2 - i.box!.x1) * (i.box!.y2 - i.box!.y1);
    // A gap below zero pulls the opening inside the pad: less paste than before, but still on the pad.
    const smaller = paste(edit((p) => ({ ...p, pasteMargin: -0.1 })));
    expect(smaller.ops).toHaveLength(2);
    expect(inkAt(smaller, pad("R1", "2"))).toBe(true);
    expect(span(smaller)).toBeLessThan(span(paste(d)));
    // A gap deeper than the pad still leaves a dot to print, never a shape turned inside out.
    expect(paste(edit((p) => ({ ...p, pasteMargin: -Math.max(w, h) }))).skipped).toEqual([]);
    expect(paste(edit((p) => ({ ...p, noPaste: true }))).ops).toHaveLength(1);
  });

  it("draws the silkscreen with strokes and keeps it off the pads", () => {
    const { out, image, pad } = files();
    const silk = image("silk-top");
    const text = out.find((f) => f.layer === "silk-top")!.text;
    expect(text).toContain("%TO.C,R1*%");
    // "Rev A" starts at (5, 3): the R's stem.
    expect(inkAt(silk, [5, 3.5])).toBe(true);
    expect(inkAt(silk, pad("R1", "1"))).toBe(false);
    expect(silk.ops.some((o) => !o.dark)).toBe(true);
    expect(image("silk-bottom").ops.filter((o) => o.dark)).toHaveLength(0);
  });

  it("writes the outline as closed paths with arcs kept as arcs", () => {
    const { out, image } = files();
    const edge = out.find((f) => f.layer === "edge")!.text;
    expect(edge).toContain("%TA.AperFunction,Profile*%");
    expect(edge.match(/G03\*/g)).toHaveLength(4);
    expect(edge.match(/D02\*/g)).toHaveLength(2);
    const img = image("edge");
    expect(img.box!.x1).toBeCloseTo(-0.05, 6);
    expect(img.box!.x2).toBeCloseTo(50.05, 6);
    expect(img.box!.y2).toBeCloseTo(40.05, 6);
    // The corner is round: its arc passes 3 - 3/√2 in from the corner both ways.
    const k = 3 - 3 / Math.SQRT2;
    expect(inkAt(img, [k, k])).toBe(true);
    expect(inkAt(img, [0, 0])).toBe(false);
    expect(inkAt(img, [25, 5])).toBe(true);
  });

  it("writes two pours that meet: the one cut into goes on as its finished fill (#750)", () => {
    const { d, nets, pad } = fabBoard();
    // A second pour on the bottom, on the other net, laid over the first one's pad and track, made to fill first.
    const p = pad("J1", "2");
    let two = addTrack(d, nets[1], "bottom", [p, [p[0] + 6, p[1]]], 0.25);
    two = addPour(two, nets[0], "bottom", [
      [p[0] + 4, p[1] - 2],
      [p[0] + 8, p[1] - 2],
      [p[0] + 8, p[1] + 2],
      [p[0] + 4, p[1] + 2],
    ]);
    two = setPour(two, two.board!.pours[1]!.id, { priority: 1 });
    const [first, second] = two.board!.pours as [Pour, Pour];
    const text = gerberFiles(two).find((f) => f.layer === "copper-bottom")!.text;
    expect(text).toContain(`G04 Pour on ${nets[1]}, as its finished fill*`);
    const img = readGerber(text);
    // Where the first pour's own copper meets its track inside the second's reach, past its pad's thermal ring, the
    // file still has it.
    const fill = pourFill(two, first);
    const pads = boardPads(two);
    const copper = copperOf(two, pads);
    const track = copper.find((c) => c.kind === "track" && c.net === nets[1] && c.layers.includes("bottom"))!;
    const reach = clearanceBetween(two.board!, nets[0], nets[1]) + track.r;
    const kept: P2[] = [];
    for (let j = 0; j < fill.h; j += 1)
      for (let i = 0; i < fill.w; i += 1) {
        const at: P2 = [fill.x0 + i * fill.step, fill.y0 + j * fill.step];
        const off = distToSegment(at, track.pts[0]!, track.pts[1]!);
        const fromArea = Math.min(...second.outline.map((a, k) => distToSegment(at, a, second.outline[(k + 1) % second.outline.length]!)));
        if (
          fill.cells[j * fill.w + i] &&
          off > track.r + 0.05 &&
          off < reach &&
          !pointInPolygon(at, second.outline) &&
          fromArea > reach + 0.2 &&
          at[0] > p[0] + 1.6
        )
          kept.push(at);
      }
    expect(kept.length).toBeGreaterThan(0);
    for (const at of kept) expect(inkAt(img, at)).toBe(true);
    // And it keeps its distance from the other pour and the other net's copper, corner by corner.
    const gap = clearanceBetween(two.board!, nets[0], nets[1]);
    const regions = img.ops.filter((o) => o.kind === "region" && o.pts.length <= 5);
    expect(regions.length).toBeGreaterThan(0);
    const outline = second.outline;
    for (const r of regions.slice(-200))
      for (const q of r.kind === "region" ? r.pts : []) {
        if (pointInPolygon(q, outline)) continue;
        const toArea = Math.min(...outline.map((a, k) => distToSegment(q, a, outline[(k + 1) % outline.length]!)));
        expect(toArea).toBeGreaterThanOrEqual(gap - 1e-6);
      }
    expect(wholeBoard(two.board!).length).toBeGreaterThan(4);
  });
});
