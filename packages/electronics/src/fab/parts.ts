import { realParts } from "../edit";
import { turn } from "../geom";
import { packageOf, type ElectronicsDesign, type Id, type Part, type Side, type Supplier } from "../model";
import { byRef } from "../nets";

/**
 * The parts lists a board house assembles from (#658, #659, #661): the bill of materials, with like parts on one row,
 * and the pick and place list, with where each part goes. Both are plain rows here; `table.ts` turns rows into the
 * columns a board house asks for.
 */
export type Mounting = "smd" | "thru" | "hybrid" | "none";

/** How a part is soldered, from its pads. */
export function mountingOf(d: ElectronicsDesign, part: Part): Mounting {
  const pads = packageOf(d, part)?.footprint.pads ?? [];
  const smd = pads.some((p) => p.kind === "smd");
  const thru = pads.some((p) => p.kind === "thru");
  return smd && thru ? "hybrid" : smd ? "smd" : thru ? "thru" : "none";
}

/** A part's supplier numbers: its own win over its component's, field by field. */
export function supplierOf(d: ElectronicsDesign, part: Part): Supplier {
  return { ...d.defs[part.def]?.supplier, ...part.supplier };
}

export interface BomRow {
  line: number;
  refs: string[];
  parts: Id[];
  qty: number;
  value: string;
  /** The package's footprint name. */
  footprint: string;
  /** The component's description, or its name when it has none. */
  description: string;
  mounting: Mounting;
  manufacturer: string;
  mpn: string;
  lcsc: string;
}

export interface Bom {
  rows: BomRow[];
  /** References marked not fitted: on the board, but left off the list. */
  unfitted: string[];
  /** References with no LCSC number, and with no manufacturer's part number. */
  noLcsc: string[];
  noMpn: string[];
}

/** The bill of materials: fitted parts, grouped where value, package and part numbers all match. */
export function bom(d: ElectronicsDesign): Bom {
  const groups = new Map<string, BomRow>();
  const unfitted: string[] = [];
  for (const part of realParts(d)) {
    if (part.fitted === false) {
      unfitted.push(part.ref);
      continue;
    }
    const def = d.defs[part.def];
    const s = supplierOf(d, part);
    const footprint = packageOf(d, part)?.footprint.name ?? "";
    const key = JSON.stringify([part.def, part.value, footprint, s.manufacturer ?? "", s.mpn ?? "", s.lcsc ?? ""]);
    const row = groups.get(key) ?? {
      line: 0,
      refs: [],
      parts: [],
      qty: 0,
      value: part.value,
      footprint,
      description: def?.description || def?.name || "",
      mounting: mountingOf(d, part),
      manufacturer: s.manufacturer ?? "",
      mpn: s.mpn ?? "",
      lcsc: s.lcsc ?? "",
    };
    row.refs.push(part.ref);
    row.parts.push(part.id);
    row.qty += 1;
    groups.set(key, row);
  }
  const rows = [...groups.values()];
  for (const r of rows) r.refs.sort(byRef);
  rows.sort((a, b) => byRef(a.refs[0]!, b.refs[0]!));
  rows.forEach((r, i) => (r.line = i + 1));
  return {
    rows,
    unfitted: unfitted.sort(byRef),
    noLcsc: rows.filter((r) => !r.lcsc).flatMap((r) => r.refs),
    noMpn: rows.filter((r) => !r.mpn).flatMap((r) => r.refs),
  };
}

export interface PlaceRow {
  part: Id;
  ref: string;
  value: string;
  footprint: string;
  /** The part's middle, mm from the board's origin, as the Gerbers have it. */
  x: number;
  y: number;
  side: Side;
  /** Degrees anticlockwise, 0 to 360, seen from the top of the board. */
  rotation: number;
  mounting: Mounting;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000 + 0;

/**
 * The pick and place list: every fitted part on the board with pads to solder. A component's own corrections (`pnp`)
 * are added here and nowhere else, because libraries and assembly lines do not all agree which way is 0°.
 * `thru: false` leaves through-hole parts out, for a line that only places surface parts.
 */
export function placeList(d: ElectronicsDesign, opts: { thru?: boolean } = {}): PlaceRow[] {
  const board = d.board;
  if (!board) return [];
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  const out: PlaceRow[] = [];
  for (const at of board.placements) {
    const part = parts.get(at.part);
    if (!part || part.fitted === false) continue;
    const mounting = mountingOf(d, part);
    if (mounting === "none" || (mounting === "thru" && opts.thru === false)) continue;
    const fix = d.defs[part.def]?.pnp;
    // The correction is in the footprint's own frame: mirrored with the part on the bottom, then turned with it.
    const off = turn([(at.side === "bottom" ? -1 : 1) * (fix?.dx ?? 0), fix?.dy ?? 0], at.rot);
    out.push({
      part: part.id,
      ref: part.ref,
      value: part.value,
      footprint: packageOf(d, part)?.footprint.name ?? "",
      x: round3(at.x + off[0]),
      y: round3(at.y + off[1]),
      side: at.side,
      rotation: round3((((at.rot + (fix?.rotation ?? 0)) % 360) + 360) % 360),
      mounting,
    });
  }
  return out.sort((a, b) => byRef(a.ref, b.ref));
}

/** Sets supplier numbers on parts (#661): a pasted column of numbers, or one field typed in the list. Empty clears. */
export function setSupplier(d: ElectronicsDesign, ids: Id[], change: Supplier): ElectronicsDesign {
  const want = new Set(ids);
  return {
    ...d,
    parts: d.parts.map((p) => {
      if (!want.has(p.id)) return p;
      const next: Supplier = { ...p.supplier };
      for (const k of ["manufacturer", "mpn", "lcsc"] as const) {
        if (!(k in change)) continue;
        const v = change[k]?.trim();
        if (v) next[k] = v;
        else delete next[k];
      }
      const rest = { ...p };
      delete rest.supplier;
      return Object.keys(next).length ? { ...rest, supplier: next } : rest;
    }),
  };
}

/** Marks parts as fitted or not. */
export function setFitted(d: ElectronicsDesign, ids: Id[], fitted: boolean): ElectronicsDesign {
  const want = new Set(ids);
  return {
    ...d,
    parts: d.parts.map((p) => {
      if (!want.has(p.id)) return p;
      const rest = { ...p };
      delete rest.fitted;
      return fitted ? rest : { ...rest, fitted: false };
    }),
  };
}
