import { isPower, type CheckLevel, type ElectronicsDesign, type Id, type P2, type PinType } from "./model";
import { byRef, netAt, netlist, type NetPin, type Netlist } from "./nets";
import { isJoined, pointsJoined, voltRange, voltsOf } from "./points";

/**
 * The electrical rules check (#634): what is wrong with a schematic before it goes to a board, in plain words, with
 * what to do about each. It only reads the design. Loaded when the Checks card opens or the board is pushed.
 */
export type RuleId =
  | "pin-open"
  | "wire-open"
  | "output-clash"
  | "input-undriven"
  | "power-undriven"
  | "net-one-pin"
  | "label-once"
  | "net-two-names"
  | "ref-duplicate"
  | "no-footprint"
  | "block-point-open"
  | "block-volts"
  | "block-two-outputs"
  | "i2c-pullups";

export interface Rule {
  id: RuleId;
  label: string;
  /** How serious it is until you say otherwise. */
  level: Exclude<CheckLevel, "ignore">;
}

export const RULES: Rule[] = [
  { id: "pin-open", label: "A pin is not connected", level: "error" },
  { id: "output-clash", label: "Two outputs drive one net", level: "error" },
  { id: "input-undriven", label: "An input has nothing driving it", level: "error" },
  { id: "ref-duplicate", label: "Two parts share a name", level: "error" },
  { id: "no-footprint", label: "A part has no footprint", level: "error" },
  { id: "block-point-open", label: "A block needs a point joined", level: "error" },
  { id: "block-volts", label: "A block gets the wrong voltage", level: "error" },
  { id: "block-two-outputs", label: "Two power outputs are joined", level: "error" },
  { id: "i2c-pullups", label: "An I2C bus has no pull-ups, or too many", level: "warning" },
  { id: "power-undriven", label: "A power pin has no power source", level: "warning" },
  { id: "wire-open", label: "A wire ends in mid air", level: "warning" },
  { id: "net-one-pin", label: "A net has only one pin", level: "warning" },
  { id: "label-once", label: "A label is used once", level: "warning" },
  { id: "net-two-names", label: "A net has two names", level: "warning" },
];

export interface CheckResult<R extends string = RuleId> {
  rule: R;
  level: Exclude<CheckLevel, "ignore">;
  /** Stable while the spot stays as it is: the rule and the pins, parts or names it is about. A waiver hangs on it. */
  key: string;
  /** What is wrong. */
  text: string;
  /** What to do about it. */
  fix: string;
  /** Where to look, when it has a place on a sheet. */
  sheet?: Id;
  at?: P2;
  /** True when `at` is a place on the board, not on a sheet. */
  board?: true;
  /** The parts it is about, to select them. */
  parts: Id[];
  /** The note it was waived with. Waived results are still listed, but not counted. */
  waived?: string;
}

export const levelOf = (d: ElectronicsDesign, rule: { id: string; level: CheckLevel }): CheckLevel => d.checks?.levels?.[rule.id] ?? rule.level;

const pinName = (p: NetPin): string => (p.name && p.name !== p.pin && p.name !== "~" ? `${p.ref} pin ${p.pin} (${p.name})` : `${p.ref} pin ${p.pin}`);
const DRIVES = new Set<PinType>(["output", "bidirectional", "tristate", "passive", "power_out", "open_collector", "open_emitter", "unspecified"]);
const pinsKey = (pins: NetPin[]): string => pins.map((p) => `${p.ref}.${p.pin}`).join(",");

/** Everything the rules find, errors first. Rules set to ignore are left out; waived results carry their note. */
export function check(d: ElectronicsDesign, nl: Netlist = netlist(d)): CheckResult[] {
  const out: CheckResult[] = [];
  const level = new Map(RULES.map((r) => [r.id, levelOf(d, r)]));
  const add = (rule: RuleId, key: string, text: string, fix: string, where: { sheet?: Id; at?: P2; parts?: Id[] } = {}) => {
    const l = level.get(rule);
    if (!l || l === "ignore") return;
    const k = `${rule}:${key}`;
    const waived = d.checks?.waived?.[k];
    out.push({
      rule,
      level: l,
      key: k,
      text,
      fix,
      parts: where.parts ?? [],
      ...(where.sheet ? { sheet: where.sheet, at: where.at } : {}),
      ...(waived !== undefined ? { waived } : {}),
    });
  };
  const at = (p: NetPin) => ({ sheet: p.sheet, at: p.at, parts: [p.part] });

  // A block's open point stands for the outside world, so the nets behind it are not short of a driver or a pin yet:
  // the block's own rules below say what it needs instead.
  const open = new Set<string>();
  for (const sheet of d.sheets)
    for (const g of sheet.groups ?? [])
      for (const p of pointsJoined(sheet, g)) {
        const name = isJoined(sheet, p.at) ? undefined : netAt(nl, sheet.id, p.at);
        if (name) open.add(name);
      }

  // A block's inside is a known circuit: a chip fed through a resistor, or two inputs tied together on purpose, is how
  // the reference design does it. Only nets scoped to the block ("MD1.VINT") are trusted this way.
  const tags = new Set(d.sheets.flatMap((s) => (s.groups ?? []).flatMap((g) => (g.block ? [g.block.tag] : []))));
  const insideBlock = (net: string) => tags.has(net.slice(0, net.indexOf(".")));

  for (const p of nl.floating)
    add(
      "pin-open",
      `${p.ref}.${p.pin}`,
      `${pinName(p)} is not connected.`,
      "Wire it up, or mark it Not connected if you are leaving it open on purpose.",
      at(p),
    );

  for (const net of nl.nets) {
    const k = pinsKey(net.pins);
    const first = net.pins[0];
    const where = first ? { ...at(first), parts: [...new Set(net.pins.map((p) => p.part))] } : {};
    for (const end of net.openEnds)
      add("wire-open", `${end.sheet}@${end.at.join(",")}`, `A wire on ${net.name} ends in mid air.`, "Carry it on to a pin or another wire, or delete it.", {
        sheet: end.sheet,
        at: end.at,
      });

    const outs = net.pins.filter((p) => p.type === "output" || p.type === "power_out");
    if (outs.length > 1)
      add(
        "output-clash",
        pinsKey(outs),
        `${list(outs.map(pinName))} ${outs.length === 2 ? "both" : "all"} drive ${net.name}.`,
        "Only one output can drive a net. Take one off, or check the pins' types.",
        {
          ...at(outs[0]!),
          parts: [...new Set(outs.map((p) => p.part))],
        },
      );

    const outside = open.has(net.name) || insideBlock(net.name);
    const driven = outside || net.power.length > 0 || net.pins.some((p) => DRIVES.has(p.type));
    for (const p of net.pins)
      if (p.type === "input" && !driven)
        add(
          "input-undriven",
          `${p.ref}.${p.pin}|${k}`,
          `${pinName(p)} is an input with nothing driving it.`,
          "Connect it to an output, or to power or ground through a resistor.",
          at(p),
        );

    const source = outside || net.power.length > 0 || net.pins.some((p) => p.type === "power_out");
    for (const p of net.pins)
      if (p.type === "power_in" && !source)
        add(
          "power-undriven",
          `${p.ref}.${p.pin}|${k}`,
          `${pinName(p)} needs power, but nothing on ${net.name} is a power source.`,
          "Add a power symbol such as 3V3 or GND to the net, or connect it to a regulator's output.",
          at(p),
        );

    if (net.pins.length === 1 && !outside && !net.power.length && !net.openEnds.length && net.labels !== 1)
      add("net-one-pin", k, `${net.name} has only one pin on it: ${pinName(first!)}.`, "Connect it to something, or mark the pin Not connected.", where);

    // Joining a block's point gives the net the block's name for it too ("MD1.VM"); that is the point of joining.
    const names = net.names.filter((n) => !insideBlock(n));
    if (names.length > 1)
      add(
        "net-two-names",
        names.join("|"),
        `One net has ${names.length === 2 ? "two" : "several"} names: ${list(names)}.`,
        "Keep one name, or take away the wire that joins them.",
        where,
      );
  }

  // A label nothing else shares: usually a slip of the keys (SDA and SDA1). One that names a net already wired between
  // two or more pins is only its name, as in KiCad, so it is left alone.
  const labels = new Map<string, { n: number; sheet: Id; at: P2 }>();
  for (const sheet of d.sheets) for (const l of sheet.labels) labels.set(l.name, { n: (labels.get(l.name)?.n ?? 0) + 1, sheet: sheet.id, at: [l.x, l.y] });
  const supplies = new Set(nl.nets.flatMap((n) => n.power));
  const pinsOn = new Map(nl.nets.map((n) => [n.name, n.pins.length]));
  const naming = (l: { sheet: Id; at: P2 }) => (pinsOn.get(netAt(nl, l.sheet, l.at) ?? "") ?? 0) >= 2;
  for (const [name, l] of labels)
    if (l.n === 1 && !supplies.has(name) && !naming(l))
      add(
        "label-once",
        name,
        `The label ${name} is used once, so it joins nothing.`,
        "Add the same label where the net carries on, or delete it if it is only a name.",
        { sheet: l.sheet, at: l.at },
      );

  const real = d.parts.filter((p) => !isPower(d, p));
  const refs = new Map<string, Id[]>();
  for (const p of real) refs.set(p.ref, [...(refs.get(p.ref) ?? []), p.id]);
  const spot = (parts: Id[]) => {
    for (const sheet of d.sheets) {
      const s = sheet.symbols.find((y) => parts.includes(y.part));
      if (s) return { sheet: sheet.id, at: [s.x, s.y] as P2, parts };
    }
    return { parts };
  };
  for (const [ref, ids] of refs)
    if (ids.length > 1) add("ref-duplicate", ref, `${ids.length} parts are called ${ref}.`, "Give each its own name, or use Renumber.", spot(ids));
  for (const p of real)
    if (!d.defs[p.def]?.packages.length)
      add(
        "no-footprint",
        p.ref,
        `${p.ref} has no footprint, so it can't go on a board.`,
        "Replace it with a part that has a package, or add a footprint to it in your library.",
        spot([p.id]),
      );

  checkBlocks(d, nl, add);

  const rank = (r: CheckResult) => (r.waived !== undefined ? 2 : r.level === "error" ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || RULES.findIndex((r) => r.id === a.rule) - RULES.findIndex((r) => r.id === b.rule) || byRef(a.key, b.key));
}

type Add = (rule: RuleId, key: string, text: string, fix: string, where?: { sheet?: Id; at?: P2; parts?: Id[] }) => void;

const FIX_OPEN: Partial<Record<string, string>> = {
  "power-in": "Pick the block and use Connect to… to join it to a supply.",
  "power-out": "Join it to what it powers, or leave it open if nothing needs it.",
  "i2c-sda": "Join it to your microcontroller's SDA pin, or use Join I2C on the block.",
  "i2c-scl": "Join it to your microcontroller's SCL pin, or use Join I2C on the block.",
  load: "Join it to the motor or the thing it switches.",
};

/** The circuit blocks' own rules (#771), in plain words: points left open, the wrong voltage, outputs that fight, I2C pull-ups. */
function checkBlocks(d: ElectronicsDesign, nl: Netlist, add: Add): void {
  const nets = new Map(nl.nets.map((n) => [n.name, n]));
  const outs = new Map<string, { block: string; point: string; volts: number | null; sheet: Id; at: P2; parts: Id[] }[]>();
  const ins: { block: string; point: string; range: [number, number]; text: string; net: string; key: string; sheet: Id; at: P2; parts: Id[] }[] = [];
  const buses = new Set<string>();
  for (const sheet of d.sheets)
    for (const g of sheet.groups ?? []) {
      if (!g.block) continue;
      const block = `${g.name} (${g.block.tag})`;
      const parts = [...new Set(sheet.symbols.filter((y) => g.members.includes(y.id)).map((y) => y.part))];
      for (const { point: p, at, joined } of pointsJoined(sheet, g)) {
        const where = { sheet: sheet.id, at, parts };
        const key = `${g.block.tag}.${p.name}`;
        if (!joined) {
          if (p.required)
            add(
              "block-point-open",
              key,
              `${block} needs ${p.name} joined${p.volts ? ` (${p.volts})` : ""}.${p.note ? ` ${p.note}.` : ""}`.replace(/\.\.$/, "."),
              FIX_OPEN[p.kind] ?? "Pick the block and use Connect to… to join it.",
              where,
            );
          continue;
        }
        const net = netAt(nl, sheet.id, at);
        if (!net) continue;
        if (p.kind === "power-out") outs.set(net, [...(outs.get(net) ?? []), { block, point: p.name, volts: voltsOf(p.volts) ?? voltsOf(p.name), ...where }]);
        if (p.kind === "power-in") {
          const range = voltRange(p.volts);
          if (range) ins.push({ block, point: p.name, range, text: p.volts!, net, key, ...where });
        }
        if (p.kind === "i2c-sda" || p.kind === "i2c-scl") buses.add(net);
      }
    }

  for (const [net, list] of outs)
    if (list.length > 1)
      add(
        "block-two-outputs",
        list.map((o) => `${o.block}.${o.point}`).join("|"),
        `${list.map((o) => `${o.block}'s ${o.point}`).join(" and ")} are joined, so two supplies fight over ${net}.`,
        "Join only one supply to a net. Take the wire off one of them.",
        { sheet: list[0]!.sheet, at: list[0]!.at, parts: list.flatMap((o) => o.parts) },
      );

  for (const p of ins) {
    const n = nets.get(p.net);
    const supplies = [...(n?.power ?? []).map(voltsOf), ...(outs.get(p.net) ?? []).map((o) => o.volts)].filter((v): v is number => v !== null && v > 0);
    const wrong = supplies.find((v) => v < p.range[0] - 0.05 || v > p.range[1] + 0.05);
    if (wrong === undefined) continue;
    const high = wrong > p.range[1];
    add(
      "block-volts",
      p.key,
      `${p.block}'s ${p.point} takes ${p.text}, but it is joined to ${fmt(wrong)}.`,
      high
        ? "That is too much. Put a regulator block between them, such as the 3.3 V regulator, or join it to a lower supply. For signals, use a level shifter block."
        : "That is too little. Join it to a higher supply, or put the 5 V boost block between them.",
      { sheet: p.sheet, at: p.at, parts: p.parts },
    );
  }

  for (const name of buses) {
    const net = nets.get(name);
    if (!net) continue;
    const pulls = [...new Set(net.pins.filter((p) => /^R\d/i.test(p.ref)).map((p) => p.part))];
    const first = net.pins[0];
    const where = first ? { sheet: first.sheet, at: first.at, parts: [...new Set(net.pins.map((p) => p.part))] } : {};
    if (!pulls.length)
      add(
        "i2c-pullups",
        `none|${name}`,
        `The I2C line ${name} has no pull-up resistor, so it can't go high.`,
        "Add a 4.7 kΩ resistor from it to 3.3 V, or use a block that has them, such as the Qwiic connector.",
        where,
      );
    else if (pulls.length > 2)
      add(
        "i2c-pullups",
        `many|${name}`,
        `The I2C line ${name} has ${pulls.length} pull-up resistors, which together pull too hard.`,
        "Keep one or two, and leave the others out of the blocks that carry them.",
        where,
      );
  }
}

const fmt = (v: number): string => `${Number(v.toFixed(2))} V`;

function list(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** How many results count, by level. Waived ones are counted apart. */
export function tally(results: CheckResult<string>[]): { errors: number; warnings: number; waived: number } {
  const live = results.filter((r) => r.waived === undefined);
  return {
    errors: live.filter((r) => r.level === "error").length,
    warnings: live.filter((r) => r.level === "warning").length,
    waived: results.length - live.length,
  };
}

/** "2 errors and 1 warning", or nothing when there are none. */
export function tallyText(t: { errors: number; warnings: number }): string {
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return [t.errors ? n(t.errors, "error") : "", t.warnings ? n(t.warnings, "warning") : ""].filter(Boolean).join(" and ");
}

/** Sets how serious a rule is. Its usual level is not kept, so the file stays small. */
export function setLevel(d: ElectronicsDesign, rule: string, level: CheckLevel, rules: { id: string; level: CheckLevel }[] = RULES): ElectronicsDesign {
  const levels = { ...d.checks?.levels };
  if (rules.find((r) => r.id === rule)?.level === level) delete levels[rule];
  else levels[rule] = level;
  return { ...d, checks: { ...d.checks, levels } };
}

/**
 * Waives one result with a note, or (no note) takes the waiver back. `live` is every key the checker that owns `rules`
 * finds now: its waivers for spots that have changed are dropped, and another checker's waivers are left alone.
 */
export function waiveIn(d: ElectronicsDesign, key: string, note: string | undefined, rules: { id: string }[], live: Iterable<string>): ElectronicsDesign {
  const now = new Set(live);
  const mine = (k: string) => rules.some((r) => k.startsWith(`${r.id}:`));
  const waived = Object.fromEntries(Object.entries(d.checks?.waived ?? {}).filter(([k]) => k !== key && (!mine(k) || now.has(k))));
  if (note !== undefined) waived[key] = note.trim();
  return { ...d, checks: { ...d.checks, waived } };
}

/** Waives a schematic result with a note, or (no note) takes the waiver back. */
export function waive(d: ElectronicsDesign, key: string, note?: string): ElectronicsDesign {
  return waiveIn(
    d,
    key,
    note,
    RULES,
    check({ ...d, checks: { ...d.checks, waived: {} } }).map((r) => r.key),
  );
}
