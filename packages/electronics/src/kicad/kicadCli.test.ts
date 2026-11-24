import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { boardPads } from "../board";
import { holesOf } from "../fab/drill";
import { gerberFiles } from "../fab/gerber";
import { inkAt, readDrill, readGerber } from "../fab/read";
import type { ElectronicsDesign, P2 } from "../model";
import { netlist } from "../nets";
import { sampleBoard } from "../sample";
import { kicadProject } from "./export";
import { tangle } from "./fixture";
import { child, children, parseSexpr, text, type Node } from "./sexpr";

/**
 * The export, opened by KiCad itself (#664). These run only where `kicad-cli` is installed (KiCad 7 or later): KiCad
 * reads the schematic and writes its netlist, reads the board and plots its copper and drill files, and each is held
 * to what the design says here. CI has no KiCad, so they are skipped there; run them after a change to the exporter.
 */
const has = spawnSync("kicad-cli", ["version"]).status === 0;

function exportTo(d: ElectronicsDesign, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "bc-kicad-"));
  for (const f of kicadProject(d, name).files) {
    mkdirSync(dirname(join(dir, f.name)), { recursive: true });
    writeFileSync(join(dir, f.name), f.text);
  }
  return dir;
}

const cli = (dir: string, ...args: string[]) => execFileSync("kicad-cli", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Nets as sorted lists of "R1:2", so two netlists can be compared whatever they call a net. */
const pinSets = (nets: { name: string; pins: string[] }[]) =>
  nets
    .filter((x) => x.pins.length > 1)
    .map((x) => [...x.pins].sort().join(" "))
    .sort();

describe.skipIf(!has).each([
  ["the sample board", "sample", sampleBoard],
  ["a design that turns everything every way", "tangle", tangle],
])("KiCad opens %s", (_what, name, make) => {
  const d = make();
  const dir = exportTo(d, name);

  it("reads the schematic and finds the same nets", () => {
    cli(dir, "sch", "export", "netlist", `${name}.kicad_sch`, "-o", "out.net");
    const tree = parseSexpr(readFileSync(join(dir, "out.net"), "utf8"))[0] as Node[];
    const theirs = children(child(tree, "nets"), "net").map((net) => ({
      name: text(child(net, "name")).replace(/^\//, ""),
      pins: children(net, "node").map((node) => `${text(child(node, "ref"))}:${text(child(node, "pin"))}`),
    }));
    const nl = netlist(d);
    const ours = nl.nets.map((net) => ({ name: net.name, pins: net.pins.map((p) => `${p.ref}:${p.pin}`) }));
    expect(pinSets(theirs)).toEqual(pinSets(ours));
    // A net we name keeps its name.
    for (const net of nl.nets.filter((x) => x.named && x.pins.length > 1)) {
      const same = theirs.find(
        (x) =>
          [...x.pins].sort().join(" ") ===
          net.pins
            .map((p) => `${p.ref}:${p.pin}`)
            .sort()
            .join(" "),
      );
      expect(same?.name, net.name).toBe(net.name);
    }
    // Every part is there, with its value and footprint.
    const comps = children(child(tree, "components"), "comp")
      .map((c) => text(child(c, "ref")))
      .sort();
    expect(comps).toEqual(
      d.parts
        .filter((p) => !d.defs[p.def]?.symbol.power)
        .map((p) => p.ref)
        .sort(),
    );
  });

  it("reads the board and plots copper where ours is", () => {
    mkdirSync(join(dir, "plot"), { recursive: true });
    cli(dir, "pcb", "export", "gerbers", `${name}.kicad_pcb`, "-o", "plot/", "--layers", "F.Cu,B.Cu,Edge.Cuts", "--no-x2", "--disable-aperture-macros");
    const board = d.board!;
    // KiCad's files sit where the board does on its page; find the shift from one pad.
    const files = readdirSync(join(dir, "plot"));
    const read = (end: string) =>
      readGerber(
        readFileSync(
          join(
            dir,
            "plot",
            files.find((f) => f.endsWith(end))!,
          ),
          "utf8",
        ),
      );
    const theirs = { top: read("F_Cu.gtl"), bottom: read("B_Cu.gbl") };
    // Ours, without the pours: KiCad has not filled its zones yet.
    const bare = { ...d, board: { ...board, pours: [] } };
    const mine = gerberFiles(bare);
    const ours = { top: readGerber(mine.find((f) => f.layer === "copper-top")!.text), bottom: readGerber(mine.find((f) => f.layer === "copper-bottom")!.text) };
    let top = -Infinity;
    let left = Infinity;
    for (const c of board.outline) {
      top = Math.max(top, c.y);
      left = Math.min(left, c.x);
    }
    // Our point in KiCad's plot: the page offset the exporter uses, with y turned back up by the plotter.
    const there = (p: P2): P2 => [p[0] + 100 - left, -(100 + top - p[1])];
    for (const side of ["top", "bottom"] as const) {
      for (const pad of boardPads(d)) {
        if (pad.pad.kind === "npth" || (pad.pad.kind === "smd" && pad.side !== side)) continue;
        // Just inside the pad's edge along its length, where a pad turned the wrong way would have no copper.
        const reach = Math.max(pad.pad.w, pad.pad.h) / 2 - 0.08;
        const along = pad.pad.w >= pad.pad.h ? 0 : 90;
        const a = ((pad.angle + along) * Math.PI) / 180;
        const tip: P2 = [pad.at[0] + reach * Math.cos(a), pad.at[1] + reach * Math.sin(a)];
        if (pad.pad.drill && reach < pad.pad.drill / 2) continue;
        expect(inkAt(theirs[side], there(tip)), `${pad.ref} pad ${pad.pad.number} on the ${side}`).toBe(true);
      }
      // And all over the board, copper in one is copper in the other, bar a sliver at the edges of shapes.
      let differ = 0;
      let seen = 0;
      for (let x = left + 0.2; x < left + 200; x += 0.23) {
        if (x > Math.max(...board.outline.map((c) => c.x))) break;
        for (let y = Math.min(...board.outline.map((c) => c.y)) + 0.2; y < top; y += 0.23) {
          seen += 1;
          if (inkAt(ours[side], [x, y]) !== inkAt(theirs[side], there([x, y]))) differ += 1;
        }
      }
      expect(differ / seen, `${side} copper that differs`).toBeLessThan(0.002);
    }
  });

  it("drills the same holes", () => {
    mkdirSync(join(dir, "drill"), { recursive: true });
    cli(dir, "pcb", "export", "drill", `${name}.kicad_pcb`, "-o", "drill/", "--excellon-units", "mm", "--excellon-separate-th");
    const board = d.board!;
    const top = Math.max(...board.outline.map((c) => c.y));
    const left = Math.min(...board.outline.map((c) => c.x));
    const hits = readdirSync(join(dir, "drill"))
      .filter((f) => f.endsWith(".drl"))
      .flatMap((f) => readDrill(readFileSync(join(dir, "drill", f), "utf8")).hits);
    const key = (at: P2, size: number) => `${at[0].toFixed(2)},${at[1].toFixed(2)} ${size.toFixed(2)}`;
    const theirs = hits.map((h) => key([h.at[0] - (100 - left), h.at[1] + 100 + top], h.d)).sort();
    const ours = holesOf(d)
      .map((h) => key(h.at, h.d))
      .sort();
    expect(theirs).toEqual(ours);
  });
});
