import { isPower, type CheckLevel, type ElectronicsDesign, type Id, type P2, type PinType } from "./model";
import { byRef, netAt, netlist, type NetPin, type Netlist } from "./nets";

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
  | "no-footprint";

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

    const driven = net.power.length > 0 || net.pins.some((p) => DRIVES.has(p.type));
    for (const p of net.pins)
      if (p.type === "input" && !driven)
        add(
          "input-undriven",
          `${p.ref}.${p.pin}|${k}`,
          `${pinName(p)} is an input with nothing driving it.`,
          "Connect it to an output, or to power or ground through a resistor.",
          at(p),
        );

    const source = net.power.length > 0 || net.pins.some((p) => p.type === "power_out");
    for (const p of net.pins)
      if (p.type === "power_in" && !source)
        add(
          "power-undriven",
          `${p.ref}.${p.pin}|${k}`,
          `${pinName(p)} needs power, but nothing on ${net.name} is a power source.`,
          "Add a power symbol such as 3V3 or GND to the net, or connect it to a regulator's output.",
          at(p),
        );

    if (net.pins.length === 1 && !net.power.length && !net.openEnds.length && net.labels !== 1)
      add("net-one-pin", k, `${net.name} has only one pin on it: ${pinName(first!)}.`, "Connect it to something, or mark the pin Not connected.", where);

    if (net.names.length > 1)
      add(
        "net-two-names",
        net.names.join("|"),
        `One net has ${net.names.length === 2 ? "two" : "several"} names: ${list(net.names)}.`,
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

  const rank = (r: CheckResult) => (r.waived !== undefined ? 2 : r.level === "error" ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || RULES.findIndex((r) => r.id === a.rule) - RULES.findIndex((r) => r.id === b.rule) || byRef(a.key, b.key));
}

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
