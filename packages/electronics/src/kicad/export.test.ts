import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sampleBoard } from "../sample";
import type { FootprintDef } from "../model";
import { kicadFootprint, kicadName, kicadProject, uuidOf } from "./export";
import { importKicadProject } from "./project";
import { tangle } from "./fixture";
import { readKicadFootprint } from "./footprint";
import { children, parseSexpr, text, type Node } from "./sexpr";
import { readKicadSymbols } from "./symbol";

/** A number as a file keeps it: to a nanometre. */
const tidy = (v: number) => Math.round(v * 1e6) / 1e6 || 0;
const here = dirname(fileURLToPath(import.meta.url));

/** Holds a written file to the copy kept beside the tests. `UPDATE_GOLDEN=1` accepts a deliberate change. */
function golden(name: string, got: string) {
  const file = join(here, "golden", name);
  if (process.env.UPDATE_GOLDEN || !existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, got);
  }
  expect(got).toBe(readFileSync(file, "utf8"));
}

describe("exporting to KiCad (#664)", () => {
  const d = sampleBoard();
  const project = kicadProject(d, "Pico servo board");
  const file = (name: string) => project.files.find((f) => f.name === name)!.text;

  it("writes a whole project: schematic, board, libraries and their tables", () => {
    expect(project.files.map((f) => f.name)).toEqual([
      "Pico_servo_board.kicad_sch",
      "Pico_servo_board.kicad_pcb",
      "Pico_servo_board.kicad_sym",
      "Pico_servo_board.pretty/0603_1608_metric.kicad_mod",
      "Pico_servo_board.pretty/0805_2012_metric.kicad_mod",
      "Pico_servo_board.pretty/1206_3216_metric.kicad_mod",
      "Pico_servo_board.pretty/DIP-16_W7.62mm.kicad_mod",
      "Pico_servo_board.pretty/Hole_3.2mm.kicad_mod",
      "Pico_servo_board.pretty/JST_SH_BM04B-SRSS-TB_1x04-1MP_P1.00mm_Vertical.kicad_mod",
      "Pico_servo_board.pretty/JST_SH_SM04B-SRSS-TB_1x04-1MP_P1.00mm_Horizontal.kicad_mod",
      "Pico_servo_board.pretty/Pin_header_1_2_2.54_mm.kicad_mod",
      "Pico_servo_board.pretty/Pin_header_1_20_2.54_mm.kicad_mod",
      "Pico_servo_board.pretty/Pin_header_1_3_2.54_mm.kicad_mod",
      "Pico_servo_board.pretty/SW_Slide-03_Wuerth-WS-SLTV_10x2.5x6.4_P2.54mm.kicad_mod",
      "Pico_servo_board.pretty/SW_SPDT_PCM12.kicad_mod",
      "sym-lib-table",
      "fp-lib-table",
      "Pico_servo_board.kicad_pro",
      "CREDITS.md",
    ]);
    // Every file but the project and the credits is one balanced list.
    for (const f of project.files) if (!/\.(kicad_pro|md)$/.test(f.name)) expect(parseSexpr(f.text), f.name).toHaveLength(1);
    expect(JSON.parse(file("Pico_servo_board.kicad_pro")).net_settings.classes[0]).toMatchObject({ name: "Default", clearance: 0.2, track_width: 0.25 });
    expect(file("sym-lib-table")).toContain("${KIPRJMOD}/Pico_servo_board.kicad_sym");
    expect(project.notes).toEqual(["Pours went across as zone outlines. In KiCad's board editor, choose Edit, Fill all zones to fill them."]);
  });

  it("comes out the same every time", () => {
    expect(kicadProject(sampleBoard(), "Pico servo board")).toEqual(project);
    golden("sample.kicad_sch", file("Pico_servo_board.kicad_sch"));
    golden("sample.kicad_pcb", file("Pico_servo_board.kicad_pcb"));
    expect(uuidOf("a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidOf("a")).not.toBe(uuidOf("b"));
    expect(kicadName(" 0805 (2012 metric) ")).toBe("0805_2012_metric");
  });

  it("writes a library our own reader takes back as the same parts", () => {
    const symbols = readKicadSymbols(file("Pico_servo_board.kicad_sym"));
    for (const def of Object.values(d.defs)) {
      // A power symbol goes out as its net's own symbol, which the test of a design on two sheets holds below.
      if (def.symbol.power) continue;
      const back = symbols.find((x) => x.name === kicadName(def.name))!;
      expect(back, def.name).toBeDefined();
      expect(back.prefix).toBe(def.prefix);
      // KiCad's symbols have no word for pins that can swap, so that one mark does not come back.
      expect(back.symbol.pins).toEqual(def.symbol.pins.map(({ swap: _, ...p }) => ({ ...p, x: tidy(p.x), y: tidy(p.y) })));
      expect(back.symbol.shapes.length).toBe(def.symbol.shapes.length);
      for (const pkg of def.packages) {
        const fp = readKicadFootprint(file(`Pico_servo_board.pretty/${kicadName(pkg.footprint.name)}.kicad_mod`)).footprint;
        expect(fp.pads).toEqual(pkg.footprint.pads.map((p) => ({ ...p, x: tidy(p.x), y: tidy(p.y) })));
      }
    }
    // The library says where each part came from.
    expect(file("CREDITS.md")).toMatch(/- Resistor: .+/);
  });

  it("keeps a pad's own mask and paste openings out to KiCad and back", () => {
    const fp: FootprintDef = {
      name: "Own openings",
      pads: [
        { number: "1", kind: "smd", shape: "rect", x: -1, y: 0, w: 1, h: 0.6, maskMargin: 0.1, pasteMargin: -0.05 },
        { number: "2", kind: "smd", shape: "rect", x: 1, y: 0, w: 1, h: 0.6, noPaste: true },
      ],
      shapes: [],
    };
    const text = kicadFootprint(fp, "Own_openings");
    expect(text).toContain("(solder_mask_margin 0.1)");
    expect(text).toContain("(solder_paste_margin -0.05)");
    expect(readKicadFootprint(text).footprint.pads).toEqual(fp.pads);
  });

  it("puts every part on the board with its pads on their nets", () => {
    const pcb = parseSexpr(file("Pico_servo_board.kicad_pcb"))[0] as Node[];
    const nets = new Map(children(pcb, "net").map((n) => [text(n, 1), text(n, 2)]));
    expect([...nets.values()].filter(Boolean).sort()).toEqual([
      "3V3",
      "5V",
      "GND",
      "LED",
      "MOTOR_A1",
      "MOTOR_A2",
      "MOTOR_A_OUT1",
      "MOTOR_A_OUT2",
      "MOTOR_B1",
      "MOTOR_B2",
      "MOTOR_B_OUT1",
      "MOTOR_B_OUT2",
      "SCL",
      "SDA",
      "SERVO1",
      "SERVO2",
      "VIN",
    ]);
    const fps = children(pcb, "footprint");
    const refs = fps
      .map((f) =>
        text(
          children(f, "fp_text").find((t) => text(t) === "reference"),
          2,
        ),
      )
      .filter((r) => r !== "H");
    expect(refs.sort()).toEqual(["C1", "D1", "J1", "J2", "J3", "J4", "J5", "J6", "J7", "J8", "R1", "SW1", "U1"]);
    expect(children(pcb, "zone")).toHaveLength(d.board!.pours.length);
    expect(children(pcb, "segment").length).toBe(d.board!.tracks.reduce((n, t) => n + t.pts.length - 1, 0));
    expect(children(pcb, "gr_arc").length).toBe(d.board!.outline.filter((c) => c.bulge).length);
  });

  it("keeps which way a net label points, both ways round (#788)", () => {
    const d = tangle();
    const sheet = d.sheets[0]!;
    const shapeOf = (name: string) => (name === "TEE" ? ("in" as const) : name === "OVER" ? ("both" as const) : undefined);
    const shaped = {
      ...d,
      sheets: [{ ...sheet, labels: sheet.labels.map((l) => (shapeOf(l.name) ? { ...l, shape: shapeOf(l.name) } : l)) }, ...d.sheets.slice(1)],
    };
    const t = kicadProject(shaped, "tangle");
    const root = parseSexpr(t.files.find((f) => f.name === "tangle.kicad_sch")!.text)[0] as Node[];
    const shapes = new Map(children(root, "global_label").map((g) => [text(g), text(g.find((x) => Array.isArray(x) && x[0] === "shape") as Node[])]));
    expect(shapes.get("TEE")).toBe("input");
    expect(shapes.get("OVER")).toBe("bidirectional");
    const back = importKicadProject(t.files.map((f) => ({ name: f.name, text: f.text })));
    const named = new Map(back.design.sheets[0]!.labels.map((l) => [l.name, l.shape]));
    expect(named.get("TEE")).toBe("in");
    expect(named.get("OVER")).toBe("both");
    expect([...named.values()].filter(Boolean)).toHaveLength(2);
  });

  it("cuts a wire where another joins it, and marks nets that span sheets as global", () => {
    const t = kicadProject(tangle(), "tangle");
    const names = t.files.map((f) => f.name);
    expect(names).toContain("tangle.kicad_sch");
    expect(names).toContain("tangle-2.kicad_sch");
    const root = parseSexpr(t.files.find((f) => f.name === "tangle.kicad_sch")!.text)[0] as Node[];
    const design = tangle();
    // Three joins in the middle of the long wire: a T, a pin and a crossing with a dot. The plain crossing is left alone.
    expect(children(root, "junction")).toHaveLength(3);
    expect(children(root, "wire").length).toBe(design.sheets[0]!.wires.length + 4);
    expect(children(root, "global_label").length).toBe(design.sheets[0]!.labels.length);
    expect(children(root, "sheet")).toHaveLength(1);
    expect(t.notes).toContain("Labels went across as global labels, so nets with one name still join between sheets.");
    // Each power symbol carries its net's name on its pin, where KiCad 7 looks, and as its value, where KiCad 8 does.
    const lib = t.files.find((f) => f.name === "tangle.kicad_sym")!.text;
    expect(
      readKicadSymbols(lib)
        .filter((x) => x.symbol.power)
        .map((x) => x.value)
        .sort(),
    ).toEqual(["5V", "GND"]);
  });
});
