import { GRID, header, power, resistor } from "./basics";
import { addLabel, addWire, changePart, placePart } from "./edit";
import { RULES, check, setLevel, tally, tallyText, waive } from "./erc";
import { emptyDesign, type ComponentDef, type ElectronicsDesign, type PinType } from "./model";

const G = GRID;

/** A chip with pins down its left side, one grid step apart, the first at the part's origin. */
function chip(name: string, pins: [string, PinType][], packages = true): ComponentDef {
  return {
    name,
    prefix: "U",
    value: name,
    symbol: {
      name,
      units: 1,
      shapes: [],
      pins: pins.map(([n, type], i) => ({ number: String(i + 1), name: n, type, x: 0, y: -i * G, length: G, dir: 0 })),
    },
    packages: packages ? header(pins.length).packages : [],
  };
}

/** Places parts 10 grid steps apart and names the net on each pin given: "U1.2": "SDA". */
function fixture(parts: ComponentDef[], nets: Record<string, string> = {}): ElectronicsDesign {
  let d = emptyDesign();
  parts.forEach((def, i) => (d = placePart(d, "sh1", def, { x: i * 10 * G, y: 0 }).design));
  for (const [pin, name] of Object.entries(nets)) {
    const [ref, number] = pin.split(".");
    const part = d.parts.find((p) => p.ref === ref)!;
    const s = d.sheets[0]!.symbols.find((y) => y.part === part.id)!;
    const at = d.defs[part.def]!.symbol.pins.find((p) => p.number === number)!;
    d = addLabel(d, "sh1", name, s.x + at.x, s.y + at.y);
  }
  return d;
}

const found = (d: ElectronicsDesign) => check(d).map((r) => `${r.level} ${r.rule}: ${r.text}`);

describe("electrical rules check", () => {
  it("passes a circuit with nothing wrong", () => {
    const d = fixture(
      [
        chip("Sensor", [
          ["VDD", "power_in"],
          ["OUT", "output"],
        ]),
        chip("MCU", [
          ["VDD", "power_in"],
          ["IN", "input"],
        ]),
        power("3V3"),
      ],
      { "U1.1": "3V3", "U2.1": "3V3", "U1.2": "SIG", "U2.2": "SIG" },
    );
    expect(found(d)).toEqual([]);
    expect(tallyText(tally(check(d)))).toBe("");
  });

  it("finds a pin left unconnected", () => {
    const d = fixture([chip("Gate", [["A", "input"]])]);
    expect(found(d)).toEqual(["error pin-open: U1 pin 1 (A) is not connected."]);
    expect(check(d)[0]).toMatchObject({
      key: "pin-open:U1.1",
      sheet: "sh1",
      at: [0, 0],
      fix: "Wire it up, or mark it Not connected if you are leaving it open on purpose.",
    });
  });

  it("finds two outputs on one net", () => {
    const d = fixture([chip("A", [["Q", "output"]]), chip("B", [["Q", "output"]])], { "U1.1": "BUS", "U2.1": "BUS" });
    expect(found(d)).toEqual(["error output-clash: U1 pin 1 (Q) and U2 pin 1 (Q) both drive BUS."]);
  });

  it("finds an input nothing drives", () => {
    const d = fixture([chip("A", [["EN", "input"]]), chip("B", [["EN", "input"]])], { "U1.1": "EN", "U2.1": "EN" });
    expect(found(d)).toEqual([
      "error input-undriven: U1 pin 1 (EN) is an input with nothing driving it.",
      "error input-undriven: U2 pin 1 (EN) is an input with nothing driving it.",
    ]);
  });

  it("finds a power pin with no power source, and is happy with a power symbol", () => {
    const parts = [chip("MCU", [["VDD", "power_in"]]), resistor()];
    let d = fixture(parts, { "U1.1": "VIN", "R1.1": "VIN", "R1.2": "VIN" });
    expect(found(d)).toEqual(["warning power-undriven: U1 pin 1 (VDD) needs power, but nothing on VIN is a power source."]);
    d = fixture([...parts, power("VIN")], { "U1.1": "VIN", "R1.1": "VIN", "R1.2": "VIN" });
    expect(found(d)).toEqual([]);
  });

  it("finds a wire that ends in mid air and a net with one pin", () => {
    let d = fixture([resistor(), resistor()], { "R1.2": "A", "R2.1": "A", "R2.2": "B", "R1.1": "B" });
    expect(found(d)).toEqual([]);
    d = addWire(d, "sh1", [0, 1.5 * G], [-3 * G, 1.5 * G]);
    expect(found(d)).toEqual(["warning wire-open: A wire on B ends in mid air."]);
    // Two labels of one name on the same lone pin: the name is used twice, yet the net still goes nowhere.
    d = fixture([chip("A", [["X", "passive"]])], { "U1.1": "LONE" });
    d = addLabel(d, "sh1", "LONE", 0, 0);
    expect(found(d)).toEqual(["warning net-one-pin: LONE has only one pin on it: U1 pin 1 (X)."]);
  });

  it("finds a label used once and a net with two names", () => {
    let d = fixture([resistor(), resistor()], { "R1.1": "SDA", "R2.1": "SDA1", "R1.2": "X", "R2.2": "X" });
    expect(found(d)).toEqual([
      "warning label-once: The label SDA is used once, so it joins nothing.",
      "warning label-once: The label SDA1 is used once, so it joins nothing.",
    ]);
    d = fixture([resistor(), resistor()], { "R1.1": "SDA", "R2.1": "SDA", "R1.2": "X", "R2.2": "X" });
    d = addLabel(d, "sh1", "DATA", 0, 1.5 * G);
    d = addLabel(d, "sh1", "DATA", 10 * G, 1.5 * G);
    expect(found(d)).toEqual(["warning net-two-names: One net has two names: DATA and SDA."]);
  });

  it("finds two parts with one name and a part with no footprint", () => {
    let d = fixture([resistor(), resistor()], { "R1.1": "A", "R2.1": "A", "R1.2": "B", "R2.2": "B" });
    d = { ...d, parts: d.parts.map((p) => ({ ...p, ref: "R1" })) };
    expect(found(d)).toEqual(["error ref-duplicate: 2 parts are called R1."]);
    d = fixture([chip("Bare", [["A", "passive"]], false), resistor()], { "U1.1": "A", "R1.1": "A", "R1.2": "A" });
    expect(found(d)).toEqual(["error no-footprint: U1 has no footprint, so it can't go on a board."]);
  });

  it("lists errors first and counts them", () => {
    const gate = chip("Gate", [
      ["A", "input"],
      ["B", "passive"],
    ]);
    const results = check(fixture([gate, chip("Other", [["A", "input"]])], { "U1.2": "ONCE", "U1.1": "N", "U2.1": "N" }));
    expect(results.map((r) => r.rule)).toEqual(["input-undriven", "input-undriven", "label-once"]);
    expect(tallyText(tally(results))).toBe("2 errors and 1 warning");
  });

  it("keeps rule levels with the design and leaves ignored rules out", () => {
    let d = fixture([chip("Gate", [["A", "input"]])]);
    d = setLevel(d, "pin-open", "warning");
    expect(found(d)).toEqual(["warning pin-open: U1 pin 1 (A) is not connected."]);
    d = setLevel(d, "pin-open", "ignore");
    expect(found(d)).toEqual([]);
    d = setLevel(d, "pin-open", "error");
    expect(d.checks?.levels).toEqual({});
    expect(RULES.map((r) => r.id)).toContain("pin-open");
  });

  it("keeps a waived result waived until its spot changes", () => {
    let d = fixture([chip("A", [["Q", "output"]]), chip("B", [["Q", "output"]])], { "U1.1": "BUS", "U2.1": "BUS" });
    const key = check(d)[0]!.key;
    d = waive(d, key, "Open drain in real life");
    expect(check(d)[0]).toMatchObject({ waived: "Open drain in real life" });
    expect(tally(check(d))).toEqual({ errors: 0, warnings: 0, waived: 1 });
    // The value is not part of the spot; a third output is.
    d = changePart(d, d.parts[0]!.id, { value: "74HC00" });
    expect(tally(check(d)).waived).toBe(1);
    const more = placePart(d, "sh1", chip("C", [["Q", "output"]]), { x: 20 * G, y: 0 }).design;
    expect(tally(check(addLabel(more, "sh1", "BUS", 20 * G, 0)))).toEqual({ errors: 1, warnings: 0, waived: 0 });
    expect(check(waive(d, key))[0]!.waived).toBeUndefined();
  });
});
