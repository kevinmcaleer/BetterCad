import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { needsKicad } from "./needsKicad";
import { boardPads } from "../board";
import type { ElectronicsDesign } from "../model";
import { netlist } from "../nets";
import { checkBoard } from "../pcb/drc";
import { boardChanges } from "../sync";
import { kicadProject } from "./export";
import { importKicadProject } from "./project";
import { child, children, parseSexpr, text, type Node } from "./sexpr";

/**
 * KiCad's own demo projects, opened here and held to what KiCad says their nets are (#663). They run only where KiCad
 * and its demos are installed (`apt install kicad kicad-demos`): the demos are not ours to keep in the repository.
 */
const DEMOS = process.env.KICAD_DEMOS ?? "/usr/share/kicad/demos";
const has = existsSync(DEMOS) && spawnSync("kicad-cli", ["version"]).status === 0;
needsKicad(has, "kicad-cli and KiCad's demos");

/** A project's folder, and the schematic its board is named after. */
const PROJECTS: [string, string][] = [
  ["ecc83", "ecc83-pp"],
  ["pic_programmer", "pic_programmer"],
  ["interf_u", "interf_u"],
  ["sonde xilinx", "sonde xilinx"],
  ["test_xil_95108", "carte_test"],
  ["stickhub", "StickHub"],
  ["complex_hierarchy", "complex_hierarchy"],
  ["flat_hierarchy", "flat_hierarchy"],
  ["custom_pads_test", "custom_pads_test"],
  ["kit-dev-coldfire-xilinx_5213", "kit-dev-coldfire-xilinx_5213"],
  ["video", "video"],
];

/** The video card's edge connector hangs over the edge of its board, as KiCad draws it. */
const OVERHANGS = ["video"];

/**
 * The same demos as KiCad 8, 9 and 10 save them (#663): a folder with one folder of demos for each version, named
 * "8.0", "9.0" and "10.0" (each is `demos/` from that branch of KiCad's source). The KiCad here may be too old to
 * open them, so their nets are held to the ones it finds in its own copy of the demo.
 */
const NEWER = process.env.KICAD_NEWER_DEMOS ?? "";
const VERSIONS = NEWER && existsSync(NEWER) ? readdirSync(NEWER).filter((v) => /^\d+\.\d+$/.test(v)) : [];
needsKicad(!NEWER || VERSIONS.length > 0, `the newer demos in ${NEWER}`);
/**
 * Demos that were changed between versions, so their nets are not KiCad 9's copy's (the one the nightly opens as
 * KICAD_DEMOS): the parts were numbered again, or a pin moved.
 */
const CHANGED: Record<string, string[]> = { complex_hierarchy: ["8.0"], video: ["10.0"] };

const filesIn = (folder: string, name: string) =>
  readdirSync(folder)
    .filter((f) => /\.kicad_sch$/.test(f) || f === `${name}.kicad_pcb` || f === `${name}.kicad_pro`)
    .filter((f) => !/\.kicad_sch$/.test(f) || !/_v2/.test(f) || /_v2/.test(name))
    .map((f) => ({ name: f, text: readFileSync(join(folder, f), "utf8") }));

/** Nets as sorted lists of "R1:2", for the nets with more than one pin. */
const netsOf = (got: ReturnType<typeof importKicadProject>) =>
  netlist(got.design)
    .nets.map((net) => [...new Set(net.pins.map((p) => `${p.ref}:${p.pin}`))].sort())
    .filter((pins) => pins.length > 1)
    .map((pins) => pins.join(" "))
    .sort();

/** Every pad: whose it is, its net, its side and where it sits. */
const padsOf = (d: ElectronicsDesign) =>
  boardPads(d)
    .map((p) => `${p.ref}:${p.pad.number} ${p.net} ${p.side} ${p.at[0].toFixed(3)},${p.at[1].toFixed(3)}`)
    .sort();

/** What KiCad itself says a schematic's nets are. */
function kicadNets(schematic: string): string[] {
  const out = join(mkdtempSync(join(tmpdir(), "bc-demo-")), "out.net");
  execFileSync("kicad-cli", ["sch", "export", "netlist", schematic, "-o", out], { stdio: ["ignore", "pipe", "pipe"] });
  const tree = parseSexpr(readFileSync(out, "utf8"))[0] as Node[];
  return children(child(tree, "nets"), "net")
    .map((net) =>
      children(net, "node")
        .map((node) => `${text(child(node, "ref"))}:${text(child(node, "pin"))}`)
        .sort(),
    )
    .filter((pins) => pins.length > 1)
    .map((pins) => pins.join(" "))
    .sort();
}

/** The board check's errors by rule, but for text written in copper, which can land a little off (see below). */
function faults(got: ReturnType<typeof importKicadProject>): Map<string, number> {
  const found = new Map<string, number>();
  for (const r of checkBoard(got.design)) if (r.level === "error" && !/the text |^The text /.test(r.text)) found.set(r.rule, (found.get(r.rule) ?? 0) + 1);
  return found;
}

describe.skipIf(!has).each(PROJECTS)("KiCad's demo %s", (dir, name) => {
  const folder = join(DEMOS, dir);
  // Read when a test runs, not when the file is collected: a skipped suite is still collected.
  let read: ReturnType<typeof importKicadProject> | undefined;
  const open = () => {
    if (read) return read;
    const files = filesIn(folder, name);
    read = importKicadProject(files, { licence: "See the KiCad demos" });
    return read;
  };

  it("has the nets KiCad finds", () => {
    expect(netsOf(open())).toEqual(kicadNets(join(folder, `${name}.kicad_sch`)));
  });

  it("has a board with nothing joined that should not be, and nothing left to route", () => {
    const got = open();
    expect(got.design.board).toBeDefined();
    expect(got.found.placed).toBe(got.design.board!.placements.length);
    // Text written in copper is left out: KiCad keeps a width and a mirror flag for text that ours does not, so a
    // line of it can land a little off, and complex_hierarchy has one near the edge.
    const found = faults(got);
    for (const rule of ["short", "unrouted", "behind", "edge"]) expect(found.get(rule) ?? 0, rule).toBe(0);
    expect(found.get("off-board") ?? 0, "off-board").toBe(OVERHANGS.includes(dir) ? 1 : 0);
    // What is left on the two layer boards: pads KiCad draws off the middle of their hole (complex_hierarchy), and
    // gaps a micron under the rule that KiCad's own check lets through (stickhub). The four layer boards were laid
    // out to finer rules than the ones that come across.
    if (got.design.board!.copperLayers === undefined) expect(found.get("clearance") ?? 0).toBeLessThanOrEqual(4);
    expect(boardChanges(got.design)).toEqual([]);
  });

  // Out again (#664): the demo as opened here, written as a KiCad project, and read by KiCad itself.
  it("goes back out to KiCad with the same nets", () => {
    const dirOut = mkdtempSync(join(tmpdir(), "bc-demo-out-"));
    for (const f of kicadProject(open().design, "trip").files) {
      mkdirSync(dirname(join(dirOut, f.name)), { recursive: true });
      writeFileSync(join(dirOut, f.name), f.text);
    }
    expect(kicadNets(join(dirOut, "trip.kicad_sch"))).toEqual(kicadNets(join(folder, `${name}.kicad_sch`)));
    // Read back here, every pad is where it was, on its net and its side.
    const back = importKicadProject(
      kicadProject(open().design, "trip").files.map((f) => ({ name: f.name, text: f.text })),
      { licence: "See the KiCad demos" },
    );
    expect(padsOf(back.design)).toEqual(padsOf(open().design));
    // And KiCad reads the board well enough to write its drill file.
    execFileSync("kicad-cli", ["pcb", "export", "drill", "trip.kicad_pcb", "-o", "drill/"], { cwd: dirOut, stdio: ["ignore", "pipe", "pipe"] });
    expect(readdirSync(join(dirOut, "drill")).some((f) => f.endsWith(".drl"))).toBe(true);
  });
});

describe
  .skipIf(!has || !VERSIONS.length)
  .each(VERSIONS.flatMap((v) => PROJECTS.filter(([dir]) => existsSync(join(NEWER, v, dir))).map(([dir, name]) => [v, dir, name] as const)))(
  "KiCad %s's demo %s",
  (v, dir, name) => {
    let read: ReturnType<typeof importKicadProject> | undefined;
    const open = () => (read ??= importKicadProject(filesIn(join(NEWER, v, dir), name), { licence: "See the KiCad demos" }));

    it.skipIf(CHANGED[dir]?.includes(v))("has the nets KiCad finds in its own copy", () => {
      expect(netsOf(open())).toEqual(kicadNets(join(DEMOS, dir, `${name}.kicad_sch`)));
    });

    it("has a board in step with its schematic, with nothing joined that should not be", () => {
      const got = open();
      expect(got.found.placed).toBe(got.design.board!.placements.length);
      const found = faults(got);
      for (const rule of ["short", "unrouted", "behind"]) expect(found.get(rule) ?? 0, rule).toBe(0);
      expect(boardChanges(got.design)).toEqual([]);
    });
  },
);
