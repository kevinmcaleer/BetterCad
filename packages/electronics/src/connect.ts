/**
 * Hooking a circuit block up (#770): for one of its connection points, the pins and other blocks' points it fits,
 * best first, and the edit that joins them.
 */
import { addWires } from "./edit";
import { key, onSegment, q } from "./geom";
import type { BlockPoint, ElectronicsDesign, Id, P2, PinType } from "./model";
import { netAt, netlist, placedPins, type Netlist } from "./nets";
import { isJoined, pointsJoined, voltsOf } from "./points";

export type Target =
  | { kind: "pin"; part: Id; pin: string; ref: string; name: string; at: P2; text: string; note: string; score: number }
  | { kind: "point"; group: Id; label: Id; name: string; at: P2; text: string; note: string; score: number };

// The Raspberry Pi Pico family's I2C pins (RP2040 and RP2350 datasheets, GPIO function table): SDA on even pins of
// each pair, SCL on the odd one after it.
const PICO_SDA = new Set([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 26]);
const PICO_SCL = new Set([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 27]);
const gpio = (name: string): number | null => {
  const m = /^GP(?:IO)?(\d+)/i.exec(name);
  return m ? Number(m[1]) : null;
};
const isPico = (defName: string) => /pico|rp2040|rp2350/i.test(defName);
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const DRIVES: PinType[] = ["output", "bidirectional", "tristate", "open_collector", "unspecified"];
/** What a point could join, best first, at most `limit`. Things inside its own block are left out. */
export function suggestTargets(d: ElectronicsDesign, sheetId: Id, groupId: Id, label: Id, limit = 8, nl: Netlist = netlist(d)): Target[] {
  const sheet = d.sheets.find((s) => s.id === sheetId);
  const g = sheet?.groups?.find((x) => x.id === groupId);
  const point = g?.block?.points.find((p) => p.label === label);
  if (!sheet || !g || !point) return [];
  const inside = new Set(sheet.symbols.filter((s) => g.members.includes(s.id)).map((s) => s.part));
  const want = norm(point.name);
  const volts = voltsOf(point.volts) ?? voltsOf(point.name);
  const out: Target[] = [];
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  for (const pin of placedPins(d)) {
    if (pin.sheet !== sheetId || inside.has(pin.part) || pin.hidden) continue;
    const part = parts.get(pin.part)!;
    const def = d.defs[part.def];
    if (!def || def.symbol.power) continue;
    const name = pin.name && pin.name !== "~" ? pin.name : pin.pin;
    const n = gpio(name);
    const used = !!nl.of.get(`${pin.part}:${pin.pin}`);
    let score = 0;
    const same = norm(name) === want || norm(name).includes(want) || (want.length > 2 && want.includes(norm(name)));
    switch (point.kind) {
      case "power-in":
        if (pin.type === "power_out") score = 40 + (volts && voltsOf(name) === volts ? 40 : 0) + (same ? 30 : 0);
        else if (same) score = 30;
        break;
      case "power-out":
        if (pin.type === "power_in") score = 40 + (same ? 30 : 0) + (volts && voltsOf(name) === volts ? 30 : 0);
        break;
      case "i2c-sda":
      case "i2c-scl": {
        const sda = point.kind === "i2c-sda";
        if (isPico(def.name) && n !== null) score = (sda ? PICO_SDA : PICO_SCL).has(n) ? 70 : 0;
        if (norm(name).includes(sda ? "SDA" : "SCL")) score = 80;
        break;
      }
      case "signal-in":
        if (DRIVES.includes(pin.type) && (n !== null || pin.type !== "bidirectional")) score = 40 + (same ? 30 : 0);
        break;
      case "signal-out":
        if (pin.type === "input" || pin.type === "bidirectional") score = 35 + (same ? 30 : 0) + (want.includes("ADC") && /ADC/i.test(name) ? 40 : 0);
        break;
      case "load":
        if (pin.type === "passive" && /^(J|M|P)/.test(part.ref)) score = 40 + (same ? 20 : 0);
        break;
      case "plain":
        if (same) score = 40;
        break;
      case "ground":
        if (/GND/i.test(name)) score = 50;
        break;
    }
    if (!score) continue;
    if (used) score -= 25;
    out.push({
      kind: "pin",
      part: pin.part,
      pin: pin.pin,
      ref: part.ref,
      name,
      at: pin.at,
      text: `${part.ref} ${name}`,
      note: used ? `${def.name}, already on ${nl.of.get(`${pin.part}:${pin.pin}`)}` : def.name,
      score,
    });
  }
  // Other blocks' points that fit: an output to an input, I2C to I2C of the same line.
  const fits: Record<BlockPoint["kind"], BlockPoint["kind"][]> = {
    "power-in": ["power-out"],
    "power-out": ["power-in"],
    ground: [],
    "i2c-sda": ["i2c-sda"],
    "i2c-scl": ["i2c-scl"],
    "signal-in": ["signal-out"],
    "signal-out": ["signal-in"],
    load: [],
    plain: ["plain", "power-in", "power-out", "signal-in", "signal-out"],
  };
  for (const other of sheet.groups ?? []) {
    if (other.id === g.id || !other.block) continue;
    for (const p of other.block.points) {
      if (!fits[point.kind].includes(p.kind)) continue;
      const l = sheet.labels.find((x) => x.id === p.label);
      if (!l) continue;
      const pv = voltsOf(p.volts) ?? voltsOf(p.name);
      const score = 60 + (norm(p.name) === want ? 25 : 0) + (volts && pv === volts ? 20 : 0) - (isJoined(sheet, [l.x, l.y]) ? 10 : 0);
      out.push({ kind: "point", group: other.id, label: p.label, name: p.name, at: [l.x, l.y], text: `${other.name}: ${p.name}`, note: p.volts ?? "", score });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.text.localeCompare(b.text, undefined, { numeric: true })).slice(0, limit);
}

/**
 * A wire from a point to a target. It runs across, up or down, then across again, at a column chosen so it touches
 * nothing on the way: no other pin, wire or label joins it by accident.
 */
export function joinPoint(d: ElectronicsDesign, sheetId: Id, from: P2, to: P2): ElectronicsDesign {
  const sheet = d.sheets.find((s) => s.id === sheetId);
  if (!sheet) return d;
  const a: P2 = [q(from[0]), q(from[1])];
  const b: P2 = [q(to[0]), q(to[1])];
  const nodes: P2[] = [
    ...placedPins(d)
      .filter((p) => p.sheet === sheetId)
      .map((p) => p.at),
    ...sheet.wires.flatMap((w) => [w.a, w.b]),
    ...sheet.labels.map((l): P2 => [l.x, l.y]),
    ...sheet.junctions.map((j): P2 => [j.x, j.y]),
  ];
  const ends = new Set([key(a[0], a[1]), key(b[0], b[1])]);
  // No pin, wire end or label but the two ends on any piece, and no bend on an existing wire.
  const segment = (p: P2, r: P2) => !nodes.some((n) => !ends.has(key(n[0], n[1])) && onSegment(n, p, r));
  const clear = (pts: P2[]): boolean =>
    pts.every((p, i) => i === 0 || segment(pts[i - 1]!, p)) && pts.slice(1, -1).every((c) => !sheet.wires.some((w) => onSegment(c, w.a, w.b)));
  if (a[1] === b[1] && clear([a, b])) return addWires(d, sheetId, [a, b]);
  const G = 2.54;
  const mid = Math.round((a[0] + b[0]) / 2 / G) * G;
  for (let step = 0; step < 60; step += 1) {
    const mx = q(mid + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * G);
    const pts: P2[] = [a, [mx, a[1]], [mx, b[1]], b];
    const path = pts.filter((p, i) => i === 0 || key(p[0], p[1]) !== key(pts[i - 1]![0], pts[i - 1]![1]));
    if (clear(path)) return addWires(d, sheetId, path);
  }
  return addWires(d, sheetId, [a, [q(mid), a[1]], [q(mid), b[1]], b]);
}

/**
 * Joins a block's open I2C points at once: SDA and SCL to the best pair, the same bus for both (a Pico's SDA on
 * GPIO 4 goes with SCL on GPIO 5).
 */
export function joinI2c(d: ElectronicsDesign, sheetId: Id, groupId: Id): { design: ElectronicsDesign; joined: string[] } {
  const sheet = d.sheets.find((s) => s.id === sheetId);
  const g = sheet?.groups?.find((x) => x.id === groupId);
  if (!sheet || !g) return { design: d, joined: [] };
  const open = pointsJoined(sheet, g).filter((p) => !p.joined && (p.point.kind === "i2c-sda" || p.point.kind === "i2c-scl"));
  const sda = open.find((p) => p.point.kind === "i2c-sda");
  const scl = open.find((p) => p.point.kind === "i2c-scl");
  let next = d;
  const joined: string[] = [];
  const nl = netlist(d);
  const tSda = sda && suggestTargets(d, sheetId, groupId, sda.point.label, 8, nl)[0];
  let tScl = scl && suggestTargets(d, sheetId, groupId, scl.point.label, 30, nl);
  // SCL on the same bus as the SDA chosen: the pin after it on a Pico, or the same block's SCL.
  if (tSda && tScl) {
    const pair = tScl.find((t) =>
      tSda.kind === "pin" && t.kind === "pin"
        ? t.part === tSda.part && gpio(t.name) === (gpio(tSda.name) ?? -9) + 1
        : tSda.kind === "point" && t.kind === "point" && t.group === tSda.group,
    );
    if (pair) tScl = [pair];
  }
  if (sda && tSda) {
    next = joinPoint(next, sheetId, sda.at, tSda.at);
    joined.push(`${sda.point.name} to ${tSda.text}`);
  }
  if (scl && tScl?.[0]) {
    next = joinPoint(next, sheetId, scl.at, tScl[0].at);
    joined.push(`${scl.point.name} to ${tScl[0].text}`);
  }
  return { design: next, joined };
}

export { isJoined, netAt, pointsJoined };
