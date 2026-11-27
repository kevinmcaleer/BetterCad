import { defOf, isPower, type ElectronicsDesign, type Part, type SimDrive, type SimSettings } from "../model";
import { byRef, netAt, netlist, placedPins } from "../nets";

/**
 * Circuit simulation (#761): the schematic written as an ngspice netlist. Each part the simulator can model becomes
 * one or more SPICE elements on numbered nodes; ground nets are node 0; power rails and driven nets become voltage
 * sources against ground. Parts it can't model (chips, connectors, switches) are left out and listed, so you can see
 * what the run ignores.
 */

/** What a run of the simulator is given, and how its answer maps back to the design. */
export interface SpiceDeck {
  text: string;
  /** Net name to SPICE node ("n3"); ground nets map to "0". */
  nodes: Map<string, string>;
  /** Parts left out, and why, in reference order. */
  skipped: { ref: string; why: string }[];
  /** Rails that need a voltage before they can be simulated. */
  unknownRails: string[];
}

/** The default run: 10 ms. */
export const SIM_STOP = 0.01;
/** Points drawn across a run. */
const POINTS = 500;

const SI: Record<string, number> = { f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, μ: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };

/**
 * A number from a part's value: "10 kΩ", "4k7", "100nF", "4.7 µF", "2R2", "1M", "5.1 V". Null when there is none.
 * A lone "M" is mega, as on a resistor's value ("1M"); write "m" for milli.
 */
export function parseQuantity(text: string): number | null {
  const s = text.trim().replace(/\s+/g, "").replace(/,/g, ".");
  // "4k7", "2R2", "1u5": the multiplier in place of the decimal point.
  const mid = /^(\d+)([fpnuµμmkKMGR])(\d+)/.exec(s);
  if (mid) {
    const scale = mid[2] === "R" ? 1 : SI[mid[2]!]!;
    return Number(`${mid[1]}.${mid[3]}`) * scale;
  }
  const m = /^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)([fpnuµμmkKMG])?/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const pre = m[2];
  return pre ? n * (SI[pre] ?? 1) : n;
}

/** A rail's voltage from its name: "+5V", "3V3", "+12V", "VBUS". Null for names that don't say (VCC, VIN). */
export function railVolts(name: string): number | null {
  const s = name.replace(/^\+/, "").toUpperCase();
  const m = /^(\d+)V(\d*)$/.exec(s) ?? /^(\d+(?:\.\d+)?)V$/.exec(s);
  if (m) return Number(m[2] ? `${m[1]}.${m[2]}` : m[1]);
  if (s === "VBUS" || s === "USB") return 5;
  return null;
}

/** Nets that are ground: GND, GNDA, AGND, 0. */
export const isGround = (net: string): boolean => /^(0|[ADP]?GND[ADP]?|GND_?\w*|VSS|EARTH)$/i.test(net.replace(/^\//, ""));

/** Rails in the design: every net a power symbol names that isn't ground, by name. */
export function railsOf(d: ElectronicsDesign): string[] {
  const nl = netlist(d);
  const out = new Set<string>();
  for (const pin of placedPins(d)) {
    if (!pin.power) continue;
    const net = netAt(nl, pin.sheet, pin.at);
    if (net && !isGround(net)) out.add(net);
  }
  return [...out].sort(byRef);
}

const VT = 0.02585;
/** A diode model that drops `vf` volts at `amps`: the saturation current from the diode equation. */
const diodeAt = (name: string, vf: number, amps: number, n: number, rs: number, extra = "") =>
  `.model ${name} D(IS=${(amps / Math.exp((vf - amps * rs) / (n * VT))).toExponential(3)} N=${n} RS=${rs}${extra})`;

/**
 * Typical models for the starter library's diodes and transistors (#761). They give the right forward drop and gain
 * for a hobby circuit; they are not the makers' own models.
 */
const MODELS: Record<string, string> = {
  D_GEN: ".model D_GEN D(IS=2.52n RS=0.568 N=1.752 CJO=4p M=0.4 TT=20n BV=100 IBV=100u)",
  D_1N4148: ".model D_1N4148 D(IS=2.52n RS=0.568 N=1.752 CJO=4p M=0.4 TT=20n BV=100 IBV=100u)",
  D_1N4007: ".model D_1N4007 D(IS=7.03n RS=0.0342 N=1.808 CJO=10p M=0.33 TT=4.3u BV=1000 IBV=5u)",
  D_SCHOTTKY: ".model D_SCHOTTKY D(IS=31.7u RS=0.051 N=1.373 CJO=110p M=0.35 BV=40 IBV=1m)",
  D_LED_RED: diodeAt("D_LED_RED", 1.9, 0.02, 2, 5, " BV=5"),
  D_LED_GREEN: diodeAt("D_LED_GREEN", 2.1, 0.02, 2, 5, " BV=5"),
  D_LED_YELLOW: diodeAt("D_LED_YELLOW", 2.0, 0.02, 2, 5, " BV=5"),
  D_LED_BLUE: diodeAt("D_LED_BLUE", 3.0, 0.02, 2.5, 5, " BV=5"),
  Q_NPN: ".model Q_NPN NPN(IS=6.734f BF=416.4 VAF=74.03 IKF=66.78m ISE=6.734f NE=1.259 BR=0.7371 RB=10 RC=1 CJC=3.638p CJE=4.493p TF=301.2p TR=239.5n)",
  Q_PNP: ".model Q_PNP PNP(IS=1.41f BF=180.7 VAF=18.7 IKF=80m NE=1.5 BR=4.977 RB=10 RC=2.5 CJC=9.728p CJE=8.063p TF=179.3p TR=33.42n)",
  Q_NPN_DARLINGTON: ".model Q_NPN_DARLINGTON NPN(IS=1e-12 BF=1000 VAF=100 IKF=3 RB=10 RC=0.1)",
  M_N_SMALL: ".model M_N_SMALL NMOS(LEVEL=1 VTO=1.6 KP=0.2 RD=1 RS=0.5 CGSO=20p CGDO=5p)",
  M_N_LOGIC: ".model M_N_LOGIC NMOS(LEVEL=1 VTO=1.0 KP=20 RD=0.01 RS=0.01 CGSO=300p CGDO=50p)",
  M_N_POWER: ".model M_N_POWER NMOS(LEVEL=1 VTO=3.0 KP=20 RD=0.01 RS=0.01 CGSO=1n CGDO=200p)",
  M_P_LOGIC: ".model M_P_LOGIC PMOS(LEVEL=1 VTO=-0.9 KP=10 RD=0.02 RS=0.02 CGSO=300p CGDO=50p)",
};

const PNP = /2N3906|BC557|BC807|BC857|MMBT3906|S8550|SS8550|2N2907|PNP/i;
const P_FET = /AO3401|IRLML6402|IRLML2244|SI2301|P-?CH|PMOS/i;
const POWER_FET = /IRF540|IRFZ44|IRF520/i;
const LOGIC_FET = /AO3400|IRLZ44|IRLB|IRL\d|SI2302/i;
const DARLINGTON = /TIP12\d|TIP14\d|ULN|DARLINGTON/i;

/** Which LED model fits a part: by the colour in its value or name. */
function ledModel(text: string): string {
  if (/blue|white|uv/i.test(text)) return "D_LED_BLUE";
  if (/green/i.test(text)) return "D_LED_GREEN";
  if (/yellow|amber|orange/i.test(text)) return "D_LED_YELLOW";
  return "D_LED_RED";
}

/** Pin numbers by the names a part's symbol gives them, upper case. */
const byName = (pins: { number: string; name: string }[]) => new Map(pins.map((p) => [p.name.toUpperCase(), p.number]));

interface Element {
  lines: string[];
  models: string[];
}

/** One part as SPICE, or why it can't be. `node` gives the node of one of its pins. */
function elementOf(d: ElectronicsDesign, part: Part, node: (pin: string) => string): Element | string {
  const def = defOf(d, part);
  if (!def) return "Its component is missing";
  const pins = def.symbol.pins;
  const names = byName(pins);
  const text = `${def.name} ${part.value}`;
  const id = part.ref.replace(/[^A-Za-z0-9_]/g, "_");
  // SPICE reads an element's kind from its first letter: R1 stays R1, a fuse F1 becomes RF1.
  const el = (letter: string) => (id.toUpperCase().startsWith(letter) ? id : `${letter}${id}`);
  const value = parseQuantity(part.value);
  const two = pins.length === 2 ? [node(pins[0]!.number), node(pins[1]!.number)] : null;
  switch (def.prefix) {
    case "R":
    case "C":
    case "L": {
      if (!two) return "It has more than two pins";
      if (value === null || !(value > 0)) return `Its value, ${part.value || "empty"}, isn't a number`;
      return { lines: [`${el(def.prefix)} ${two[0]} ${two[1]} ${value}`], models: [] };
    }
    case "FB":
    case "F":
      // A ferrite bead or a fuse: a fraction of an ohm in the path.
      if (!two) return "It has more than two pins";
      return { lines: [`${el("R")} ${two[0]} ${two[1]} 0.05`], models: [] };
    case "RV": {
      // A potentiometer at its middle: half the value each side of the wiper (pin 2).
      if (pins.length !== 3 || value === null || !(value > 0)) return "Its value isn't a number";
      return { lines: [`${el("R")}a ${node("1")} ${node("2")} ${value / 2}`, `${el("R")}b ${node("2")} ${node("3")} ${value / 2}`], models: [] };
    }
    case "D": {
      const a = names.get("A");
      const k = names.get("K");
      if (pins.length !== 2 || !a || !k) return "It isn't a two-pin diode";
      const model = /led/i.test(def.name)
        ? ledModel(text)
        : /zener/i.test(text)
          ? "zener"
          : /schottky|1N58|SS1\d|SS3\d|BAT/i.test(text)
            ? "D_SCHOTTKY"
            : /1N400/i.test(text)
              ? "D_1N4007"
              : /1N4148/i.test(text)
                ? "D_1N4148"
                : "D_GEN";
      if (model === "zener") {
        const bv = value ?? 5.1;
        const name = `D_ZENER_${String(bv).replace(".", "V")}`;
        return { lines: [`${el("D")} ${node(a)} ${node(k)} ${name}`], models: [`.model ${name} D(IS=1n RS=1 N=1.5 BV=${bv} IBV=5m)`] };
      }
      return { lines: [`${el("D")} ${node(a)} ${node(k)} ${model}`], models: [MODELS[model]!] };
    }
    case "Q": {
      const [b, c, e] = ["B", "C", "E"].map((n) => names.get(n));
      if (b && c && e) {
        const model = DARLINGTON.test(text) ? "Q_NPN_DARLINGTON" : PNP.test(text) ? "Q_PNP" : "Q_NPN";
        return { lines: [`${el("Q")} ${node(c)} ${node(b)} ${node(e)} ${model}`], models: [MODELS[model]!] };
      }
      const [g, dr, s] = ["G", "D", "S"].map((n) => names.get(n));
      if (g && dr && s) {
        const model = P_FET.test(text) ? "M_P_LOGIC" : POWER_FET.test(text) ? "M_N_POWER" : LOGIC_FET.test(text) ? "M_N_LOGIC" : "M_N_SMALL";
        return { lines: [`${el("M")} ${node(dr)} ${node(g)} ${node(s)} ${node(s)} ${model}`], models: [MODELS[model]!] };
      }
      return "Its pins aren't named B, C and E or G, D and S";
    }
    case "BT": {
      const plus = names.get("+");
      const minus = names.get("-");
      if (!plus || !minus) return "Its pins aren't named + and -";
      const volts = /CR20\d\d|CR16\d\d|CR12\d\d/i.test(text) ? 3 : value;
      if (volts === null || !(volts > 0)) return "Give it a voltage as its value, such as 9 V";
      return { lines: [`${el("V")} ${node(plus)} ${node(minus)} DC ${volts}`], models: [] };
    }
    default:
      return "The simulator has no model for it";
  }
}

/** A driven net's source. */
function driveSource(drive: SimDrive): string {
  if (drive.wave === "dc") return `DC ${drive.high}`;
  const f = drive.freq && drive.freq > 0 ? drive.freq : 1000;
  if (drive.wave === "sine") return `SIN(${(drive.low + drive.high) / 2} ${(drive.high - drive.low) / 2} ${f})`;
  const period = 1 / f;
  const edge = period / 1000;
  return `PULSE(${drive.low} ${drive.high} 0 ${edge} ${edge} ${period / 2 - edge} ${period})`;
}

/** The design as an ngspice deck for a transient run (#761). */
export function spiceDeck(d: ElectronicsDesign, settings: SimSettings = d.sim ?? {}): SpiceDeck {
  const nl = netlist(d);
  const nodes = new Map<string, string>();
  let count = 0;
  const nodeOf = (net: string) => {
    if (isGround(net)) return "0";
    let n = nodes.get(net);
    if (!n) nodes.set(net, (n = `n${(count += 1)}`));
    return n;
  };
  // Every net gets its node up front, so the numbers follow the nets' order; ground nets say "0", so a probe on one reads flat.
  for (const net of nl.nets) if (isGround(net.name)) nodes.set(net.name, "0");
  for (const net of nl.nets) nodeOf(net.name);

  const lines: string[] = [];
  const models = new Set<string>();
  const skipped: SpiceDeck["skipped"] = [];
  let free = 0;
  const parts = [...d.parts].sort((a, b) => byRef(a.ref, b.ref));
  for (const part of parts) {
    if (isPower(d, part) || part.fitted === false) continue;
    const node = (pin: string) => {
      const net = nl.of.get(`${part.id}:${pin}`);
      // A pin on no net gets a node of its own; the shunt below keeps it from floating.
      return net ? nodeOf(net) : `nc${(free += 1)}`;
    };
    const el = elementOf(d, part, node);
    if (typeof el === "string") skipped.push({ ref: part.ref, why: el });
    else {
      lines.push(...el.lines);
      for (const m of el.models) models.add(m);
    }
  }

  // Rails: a source against ground, at the voltage its name says or the one set for it.
  const unknownRails: string[] = [];
  const driven = new Set((settings.drives ?? []).map((x) => x.net));
  for (const rail of railsOf(d)) {
    if (driven.has(rail)) continue;
    const volts = settings.rails?.[rail] ?? railVolts(rail);
    if (volts === null || volts === undefined) {
      unknownRails.push(rail);
      continue;
    }
    lines.push(`V_${nodeOf(rail)} ${nodeOf(rail)} 0 DC ${volts}`);
  }
  for (const drive of settings.drives ?? []) {
    if (!nodes.has(drive.net) || isGround(drive.net)) continue;
    lines.push(`V_drive_${nodeOf(drive.net)} ${nodeOf(drive.net)} 0 ${driveSource(drive)}`);
  }

  const stop = settings.stop && settings.stop > 0 ? settings.stop : SIM_STOP;
  const text = [
    "* BetterCad simulation",
    // Every node gets a very high resistance to ground, so a pin left open doesn't stop the run.
    ".options rshunt=1e12",
    ...[...models].sort(),
    ...lines,
    `.tran ${Number((stop / POINTS).toPrecision(3))} ${stop}`,
    ".end",
  ].join("\n");
  return { text, nodes, skipped, unknownRails };
}

/** One probed net's voltage over the run. */
export interface SimTrace {
  net: string;
  volts: number[];
}

/** The simulator's answer: a time for each point, and a trace per probe. */
export interface SimResult {
  time: number[];
  traces: SimTrace[];
}

/** The engine's vectors (name and values, as eecircuit-engine returns them) as traces for the probed nets. */
export function tracesOf(deck: SpiceDeck, vectors: { name: string; values: number[] }[], probes: string[]): SimResult {
  const byName = new Map(vectors.map((v) => [v.name.toLowerCase(), v.values]));
  const time = byName.get("time") ?? [];
  const traces = probes.map((net) => {
    const n = deck.nodes.get(net);
    const volts = n === "0" ? time.map(() => 0) : n ? (byName.get(`v(${n})`) ?? []) : [];
    return { net, volts };
  });
  return { time, traces };
}
