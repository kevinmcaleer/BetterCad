import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { netlist } from "../nets";
import { checkBoard } from "../pcb/drc";
import { boardChanges } from "../sync";
import { importKicadProject } from "./project";
import { child, children, parseSexpr, text, type Node } from "./sexpr";

/**
 * KiCad's own demo projects, opened here and held to what KiCad says their nets are (#663). They run only where KiCad
 * and its demos are installed (`apt install kicad kicad-demos`): the demos are not ours to keep in the repository.
 */
const DEMOS = process.env.KICAD_DEMOS ?? "/usr/share/kicad/demos";
const has = existsSync(DEMOS) && spawnSync("kicad-cli", ["version"]).status === 0;

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

const FOUR_LAYERS = ["kit-dev-coldfire-xilinx_5213", "video"];

describe.skipIf(!has).each(PROJECTS)("KiCad's demo %s", (dir, name) => {
  const folder = join(DEMOS, dir);
  const files = readdirSync(folder)
    .filter((f) => /\.kicad_sch$/.test(f) || f === `${name}.kicad_pcb` || f === `${name}.kicad_pro`)
    .filter((f) => !/\.kicad_sch$/.test(f) || !/_v2/.test(f) || /_v2/.test(name))
    .map((f) => ({ name: f, text: readFileSync(join(folder, f), "utf8") }));
  const got = importKicadProject(files, { licence: "See the KiCad demos" });

  it("has the nets KiCad finds", () => {
    const out = join(mkdtempSync(join(tmpdir(), "bc-demo-")), "out.net");
    execFileSync("kicad-cli", ["sch", "export", "netlist", join(folder, `${name}.kicad_sch`), "-o", out], { stdio: ["ignore", "pipe", "pipe"] });
    const tree = parseSexpr(readFileSync(out, "utf8"))[0] as Node[];
    const theirs = children(child(tree, "nets"), "net")
      .map((net) =>
        children(net, "node")
          .map((node) => `${text(child(node, "ref"))}:${text(child(node, "pin"))}`)
          .sort(),
      )
      .filter((pins) => pins.length > 1)
      .map((pins) => pins.join(" "))
      .sort();
    const ours = netlist(got.design)
      .nets.map((net) => [...new Set(net.pins.map((p) => `${p.ref}:${p.pin}`))].sort())
      .filter((pins) => pins.length > 1)
      .map((pins) => pins.join(" "))
      .sort();
    expect(ours).toEqual(theirs);
  });

  // The two four layer boards lose their inside layers on the way in, so their copper is not whole.
  it.skipIf(FOUR_LAYERS.includes(dir))("has a board with nothing joined that should not be, and nothing left to route", () => {
    expect(got.design.board).toBeDefined();
    expect(got.found.placed).toBe(got.design.board!.placements.length);
    const found = new Map<string, number>();
    for (const r of checkBoard(got.design)) if (r.level === "error") found.set(r.rule, (found.get(r.rule) ?? 0) + 1);
    for (const rule of ["short", "unrouted", "behind", "off-board", "edge"]) expect(found.get(rule) ?? 0, rule).toBe(0);
    // What is left: pads KiCad draws off the middle of their hole (complex_hierarchy), and gaps a micron under the
    // rule that KiCad's own check lets through (stickhub).
    expect(found.get("clearance") ?? 0).toBeLessThanOrEqual(4);
    expect(boardChanges(got.design)).toEqual([]);
  });
});
