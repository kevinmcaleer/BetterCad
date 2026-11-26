import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBlock, nextTag, placeBlock, shownName, type BlockSpec } from "./blocks";
import { removeFromSheet, moveOnSheet } from "./edit";
import { groupBoxes, ungroupOnSheet } from "./groups";
import { inflate, type LibraryPack } from "./library/pack";
import { emptyDesign } from "./model";
import { netlist } from "./nets";

const pack = JSON.parse(readFileSync(join(__dirname, "../library/starter.json"), "utf8")) as LibraryPack;
export const lookup = (id: string) => {
  const p = pack.parts.find((x) => x.id === id);
  return p && inflate(pack, p);
};

const driver: BlockSpec = {
  id: "test-motor",
  version: 1,
  name: "Two DC motors",
  shelf: "Motors",
  summary: "Drives two small DC motors.",
  tag: "MD",
  source: { title: "DRV8833 datasheet", url: "https://www.ti.com/lit/ds/symlink/drv8833.pdf" },
  parts: [
    { ref: "U1", part: "drv8833pw", note: "The motor driver chip" },
    { ref: "C1", part: "capacitor", value: "10 µF", note: "Keeps the motor supply steady" },
  ],
  nets: {
    VM: ["U1.VM", "C1.1"],
    GND: ["U1.GND", "U1.AISEN", "U1.BISEN", "C1.2"],
    AIN1: ["U1.AIN1"],
    AOUT1: ["U1.AOUT1"],
  },
  points: [
    { name: "VM", net: "VM", kind: "power-in", volts: "2.7 to 10.8 V", required: true },
    { name: "GND", net: "GND", kind: "ground", global: true, required: true },
    { name: "AIN1", net: "AIN1", kind: "signal-in" },
    { name: "A+", net: "AOUT1", kind: "load" },
  ],
};

const pinNet = (d: ReturnType<typeof emptyDesign>, ref: string, pinName: string) => {
  const nl = netlist(d);
  const part = d.parts.find((p) => p.ref === ref)!;
  const pin = d.defs[part.def]!.symbol.pins.find((p) => p.name === pinName || p.number === pinName)!;
  return nl.of.get(`${part.id}:${pin.number}`);
};

describe("circuit blocks (#767)", () => {
  it("builds a block: labels on joined pins, points round the outline", () => {
    const b = buildBlock(driver, lookup);
    expect(b.clip.parts.map((p) => p.ref)).toEqual(["U1", "C1"]);
    expect(b.points.map((p) => [p.name, p.kind])).toEqual([
      ["AIN1", "signal-in"],
      ["A+", "load"],
      ["VM", "power-in"],
      ["GND", "ground"],
    ]);
    const names = b.clip.labels.map((l) => l.name);
    expect(names).toContain("@.VM");
    expect(names).toContain("GND");
    expect(() => buildBlock({ ...driver, nets: { X: ["U1.NOPE"] } }, lookup)).toThrow("has no pin NOPE");
  });

  it("places as a group with its own tag, and its nets match the wiring the spec asks for", () => {
    const built = buildBlock(driver, lookup);
    const one = placeBlock(emptyDesign(), "sh1", built, [0, 0]);
    const sheet = one.design.sheets[0]!;
    const g = sheet.groups![0]!;
    expect(g).toMatchObject({ name: "Two DC motors", block: { def: "test-motor", version: 1, tag: "MD1" } });
    expect(g.members).toHaveLength(one.ids.length);
    expect(Object.values(g.block!.notes!)).toEqual(["The motor driver chip", "Keeps the motor supply steady"]);
    const d = one.design;
    expect(pinNet(d, "U1", "VM")).toBe("MD1.VM");
    expect(pinNet(d, "C1", "1")).toBe("MD1.VM");
    expect(pinNet(d, "U1", "AISEN")).toBe("GND");
    expect(pinNet(d, "C1", "2")).toBe("GND");
    // Every point is a label on the inside net of its name.
    for (const p of g.block!.points)
      expect(sheet.labels.find((l) => l.id === p.label)!.name).toBe(p.name === "GND" ? "GND" : `MD1.${p.name === "A+" ? "AOUT1" : p.name}`);
    expect(shownName("MD1.VM", "MD1")).toBe("VM");
    expect(shownName("GND", "MD1")).toBe("GND");
  });

  it("keeps two copies' inside nets apart; only ground joins", () => {
    const built = buildBlock(driver, lookup);
    const one = placeBlock(emptyDesign(), "sh1", built, [0, 0]);
    const two = placeBlock(one.design, "sh1", built, [0, -80]);
    const d = two.design;
    expect(d.parts.map((p) => p.ref)).toEqual(["U1", "C1", "U2", "C2"]);
    expect(nextTag(d, "MD")).toBe("MD3");
    expect(d.sheets[0]!.groups!.map((g) => g.block!.tag)).toEqual(["MD1", "MD2"]);
    expect(pinNet(d, "U2", "VM")).toBe("MD2.VM");
    expect(pinNet(d, "U1", "VM")).not.toBe(pinNet(d, "U2", "VM"));
    expect(pinNet(d, "U2", "AISEN")).toBe("GND");
  });

  it("puts every point on the outline", () => {
    const one = placeBlock(emptyDesign(), "sh1", buildBlock(driver, lookup), [10, 10]);
    const sheet = one.design.sheets[0]!;
    const [o] = groupBoxes(one.design, sheet);
    for (const p of sheet.groups![0]!.block!.points) {
      const l = sheet.labels.find((x) => x.id === p.label)!;
      const onEdge =
        Math.abs(l.x - o!.box.x1) < 1e-6 || Math.abs(l.x - o!.box.x2) < 1e-6 || Math.abs(l.y - o!.box.y1) < 1e-6 || Math.abs(l.y - o!.box.y2) < 1e-6;
      expect(onEdge, `${p.name} at ${l.x},${l.y} on ${JSON.stringify(o!.box)}`).toBe(true);
    }
  });

  it("moves as one, and ungroups into plain parts whose points stay as net labels", () => {
    const one = placeBlock(emptyDesign(), "sh1", buildBlock(driver, lookup), [0, 0]);
    const g = one.design.sheets[0]!.groups![0]!;
    const moved = moveOnSheet(one.design, "sh1", g.members, 25.4, 0);
    expect(pinNet(moved, "U1", "VM")).toBe("MD1.VM");
    const plain = ungroupOnSheet(moved, "sh1", g.id);
    expect(plain.sheets[0]!.groups).toBeUndefined();
    expect(plain.sheets[0]!.labels.some((l) => l.name === "MD1.VM")).toBe(true);
    expect(pinNet(plain, "U1", "VM")).toBe("MD1.VM");
    // Deleting the block takes its parts with it.
    expect(removeFromSheet(one.design, "sh1", g.members).parts).toEqual([]);
  });

  it("goes to KiCad flattened, with the outline as a box", async () => {
    const one = placeBlock(emptyDesign(), "sh1", buildBlock(driver, lookup), [0, 0]);
    const { kicadProject } = await import("./kicad/export");
    const sch = kicadProject(one.design, "Blocks").files.find((f) => f.name.endsWith(".kicad_sch"))!.text;
    expect(sch).toContain('"MD1.VM"');
    expect(sch).toContain('(text "Two DC motors"');
  });
});

describe("the starter blocks (#769)", () => {
  it("has the 19 blocks Kev agreed, each one building from starter parts", async () => {
    const { STARTER_BLOCKS } = await import("./library/blocks");
    expect(STARTER_BLOCKS).toHaveLength(19);
    expect(new Set(STARTER_BLOCKS.map((b) => b.id)).size).toBe(19);
    for (const spec of STARTER_BLOCKS) {
      const built = buildBlock(spec, lookup);
      expect(built.points.length, spec.id).toBe(spec.points.length);
      // Every net in the spec reaches its pins once placed.
      const one = placeBlock(emptyDesign(), "sh1", built, [0, 0]);
      const nl = netlist(one.design);
      for (const [net, pins] of Object.entries(spec.nets)) {
        const names = new Set(
          pins.flatMap((r) => {
            const [ref, pin] = [r.slice(0, r.indexOf(".")), r.slice(r.indexOf(".") + 1)];
            const part = one.design.parts[spec.parts.findIndex((p) => p.ref === ref)]!;
            const def = one.design.defs[part.def]!;
            const nums = def.symbol.pins.filter((p) => p.number === pin).length ? [pin] : def.symbol.pins.filter((p) => p.name === pin).map((p) => p.number);
            return nums.map((n) => nl.of.get(`${part.id}:${n}`));
          }),
        );
        expect([...names], `${spec.id} ${net}`).toHaveLength(1);
      }
      // Points sit on the outline.
      const sheet = one.design.sheets[0]!;
      const [o] = groupBoxes(one.design, sheet);
      for (const p of sheet.groups![0]!.block!.points) {
        const l = sheet.labels.find((x) => x.id === p.label)!;
        const on = [l.x - o!.box.x1, l.x - o!.box.x2, l.y - o!.box.y1, l.y - o!.box.y2].some((v) => Math.abs(v) < 1e-6);
        expect(on, `${spec.id} ${p.name}`).toBe(true);
      }
    }
  });
});

describe("the starter blocks' versions (#773)", () => {
  it("are listed apart, in step with the blocks", async () => {
    const { STARTER_VERSIONS } = await import("./library/blockVersions");
    const { STARTER_BLOCKS } = await import("./library/blocks");
    expect(STARTER_VERSIONS).toEqual(Object.fromEntries(STARTER_BLOCKS.map((b) => [b.id, b.version])));
  });
});
