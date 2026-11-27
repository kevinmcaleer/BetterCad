import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BASICS } from "./basics";
import { addWire, placePart } from "./edit";
import { importEagleProject } from "./eagle/project";
import { check } from "./erc";
import { fabBoard } from "./fab/fixture";
import { HOUSES, orderPack } from "./fab/pack";
import { readDrill, readGerber } from "./fab/read";
import { kicadProject } from "./kicad/export";
import { tangle } from "./kicad/fixture";
import { importKicadProject } from "./kicad/project";
import { emptyDesign, withFixedIds, type ElectronicsDesign } from "./model";
import { byRef, netlist } from "./nets";
import { checkBoard } from "./pcb/drc";
import { sampleBoard } from "./sample";
import { robotBlocksBoard } from "./sampleBlocks";
import { boardChanges, describeChange, pushToBoard } from "./sync";

/**
 * Fixture designs (#667): saved electronics designs kept in `fixtures/electronics/`, each with a golden list beside
 * it of its nets, what Push to PCB would change, and what the schematic and board checks say. A design saved today
 * must read the same tomorrow. Nightly, every fixture with a board also writes its order files for each board house,
 * which must read back, and goes out to KiCad and comes home with the same nets.
 *
 * `UPDATE_GOLDEN=1 npm run test:golden` writes the designs and their lists again after a deliberate change.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIR = join(ROOT, "fixtures", "electronics");
const UPDATE = !!process.env.UPDATE_GOLDEN;

/** A resistor and an LED, half wired, pushed to a board, then a second LED added: something for every list to say. */
function unfinished(): ElectronicsDesign {
  return withFixedIds(() => {
    let d = emptyDesign();
    const sheet = d.sheets[0]!.id;
    d = placePart(d, sheet, BASICS.resistor!(), { x: -25.4, y: 0 }).design;
    d = placePart(d, sheet, BASICS.led!(), { x: 0, y: 0 }).design;
    d = addWire(d, sheet, [-25.4, 3.81], [0, 3.81]);
    d = pushToBoard(d).design;
    return placePart(d, sheet, BASICS.led!(), { x: 25.4, y: 0 }).design;
  });
}

const eagle = (name: string) => ({ name, text: readFileSync(join(dirname(fileURLToPath(import.meta.url)), "eagle", "fixtures", name), "utf8") });

/** How each fixture was first made. The file on disk is what is tested: these only run under UPDATE_GOLDEN. */
const MAKE: Record<string, () => ElectronicsDesign> = {
  "pico-servo-board": sampleBoard,
  "robot-blocks": robotBlocksBoard,
  "fab-board": () => fabBoard().d,
  tangle,
  unfinished,
  "eagle-turns": () => withFixedIds(() => importEagleProject([eagle("turns.sch"), eagle("turns.brd")], { licence: "CC0 1.0 (no rights kept)" }).design),
};

if (UPDATE) {
  mkdirSync(DIR, { recursive: true });
  for (const [name, make] of Object.entries(MAKE)) writeFileSync(join(DIR, `${name}.design.json`), `${JSON.stringify(make(), null, 1)}\n`);
}

const NAMES = Object.keys(MAKE).sort();
const load = (name: string): ElectronicsDesign => JSON.parse(readFileSync(join(DIR, `${name}.design.json`), "utf8")) as ElectronicsDesign;

/** Nets with two pins or more, as sorted lines of "ref:pin". */
const netLines = (d: ElectronicsDesign): string[] =>
  netlist(d)
    .nets.map((n) => [...new Set(n.pins.map((p) => `${p.ref}:${p.pin}`))].sort(byRef))
    .filter((pins) => pins.length > 1)
    .map((pins) => pins.join(" "))
    .sort();

/** Everything the golden file pins down, as text a person can read in a diff. */
function report(d: ElectronicsDesign): string {
  const nl = netlist(d);
  const nets = nl.nets.map((n) => `${n.name}: ${[...new Set(n.pins.map((p) => `${p.ref}:${p.pin}`))].sort(byRef).join(" ") || "no pins"}`).sort();
  const results = (list: { rule: string; level: string; text: string; waived?: string }[]) =>
    list.map((r) => `${r.level}${r.waived !== undefined ? " (waived)" : ""} ${r.rule}: ${r.text}`).sort();
  const section = (title: string, lines: string[]) => [`## ${title}`, ...(lines.length ? lines : ["Nothing."]), ""];
  return [
    ...section("Nets", nets),
    ...section("Push to PCB", boardChanges(d, nl).map(describeChange)),
    ...section("Schematic check", results(check(d, nl))),
    ...section("Board check", d.board ? results(checkBoard(d, nl)) : ["No board."]),
  ].join("\n");
}

describe("electronics fixtures", () => {
  it("keeps a design file for every fixture, and no strays", () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith(".design.json"))
      .map((f) => f.replace(".design.json", ""))
      .sort();
    expect(files).toEqual(NAMES);
  });

  it.each(NAMES)("%s: nets, changes and checks match the golden list", async (name) => {
    const want = join(DIR, `${name}.golden.txt`);
    if (!UPDATE && process.env.CI && !existsSync(want)) throw new Error(`No ${want}. Run UPDATE_GOLDEN=1 npm run test:golden and commit it.`);
    await expect(report(load(name))).toMatchFileSnapshot(want);
  });

  it("covers a finished board and one with work left", () => {
    const done = load("pico-servo-board");
    expect(boardChanges(done)).toEqual([]);
    expect(checkBoard(done).filter((r) => r.level === "error" && r.waived === undefined)).toEqual([]);
    const open = load("unfinished");
    expect(boardChanges(open).map((c) => c.kind)).toContain("add-part");
    expect(check(open).length).toBeGreaterThan(0);
  });
});

describe.skipIf(!process.env.NIGHTLY)("nightly: every electronics fixture with a board", () => {
  const boards = NAMES.filter((name) => existsSync(join(DIR, `${name}.design.json`)) && !!load(name).board);

  it("has boards to run", () => {
    expect(boards.length).toBeGreaterThanOrEqual(4);
  });

  it.each(boards)("%s: the order files for each house read back", (name) => {
    const d = load(name);
    for (const house of HOUSES) {
      const pack = orderPack(d, house.id, name)!;
      expect(pack.gerbers.length, house.id).toBeGreaterThanOrEqual(9);
      for (const f of pack.gerbers) {
        if (f.layer === "drill-plated" || f.layer === "drill-bare") {
          const drill = readDrill(f.text);
          expect(drill.plated, f.name).toBe(f.layer === "drill-plated");
          expect(drill.hits.length, f.name).toBeGreaterThan(0);
        } else if (f.layer === "edge" || f.layer === "copper-top") {
          expect(readGerber(f.text).ops.length, f.name).toBeGreaterThan(0);
        } else readGerber(f.text);
      }
      expect(pack.bomTable.length, house.id).toBe(pack.bom.rows.length + 1);
      expect(pack.placeTable.length, house.id).toBe(pack.place.length + 1);
    }
  });

  it.each(boards)("%s: out to KiCad and back with the same nets", (name) => {
    const d = load(name);
    const out = kicadProject(d, name);
    const back = importKicadProject(
      out.files.map((f) => ({ name: f.name, text: f.text })),
      { licence: "Not stated" },
    );
    expect(netLines(back.design)).toEqual(netLines(d));
    expect(back.design.board?.placements.length).toBe(d.board!.placements.length);
  });
});
