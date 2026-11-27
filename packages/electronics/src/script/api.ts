import { addLabel, addWire, changePart, placePart, renumber } from "../edit";
import { setSupplier } from "../fab/parts";
import { defOf, isPower, type CopperLayer, type ElectronicsDesign, type Id, type P2, type Side, type Supplier } from "../model";
import { byRef, netlist } from "../nets";
import { addNetClass, setNetClass } from "../pcb/netclass";
import { addTrack, addVia, setPlacement } from "../pcb/route";
import { setRule, type RuleField } from "../pcb/rules";

/**
 * Scripts (#764): the `bc` object a script is given, and nothing else. Reads hand back plain copies; writes are
 * checked as they are made and collected as a list of changes, which apply only once the script has ended and you
 * have chosen Keep. Each change goes through the same edit function the editor uses, so a script can't make a
 * design the editor couldn't. Millimetres and degrees, as everywhere.
 */

export type ScriptChange =
  | { kind: "value"; ref: string; value: string }
  | { kind: "fitted"; ref: string; fitted: boolean }
  | { kind: "partNumber"; ref: string; supplier: Supplier }
  | { kind: "renumber" }
  | { kind: "label"; sheet: Id; name: string; x: number; y: number }
  | { kind: "place"; like: string; sheet: Id; x: number; y: number; rot: 0 | 90 | 180 | 270; value?: string }
  | { kind: "wire"; sheet: Id; a: P2; b: P2 }
  | { kind: "move"; ref: string; x: number; y: number; rot?: number; side?: Side }
  | { kind: "track"; net: string; layer: CopperLayer; pts: P2[]; width?: number }
  | { kind: "via"; net: string; x: number; y: number }
  | { kind: "rule"; field: RuleField; value: number }
  | { kind: "netClass"; net: string; cls: string | null };

/** What a script shows: lines and tables in the Script card, and files you can save. */
export type ScriptOutput = { kind: "say"; text: string } | { kind: "table"; rows: string[][] } | { kind: "file"; name: string; text: string };

export interface ScriptPart {
  ref: string;
  value: string;
  /** The component's name ("Resistor"). */
  name: string;
  prefix: string;
  /** The footprint it uses on the board. */
  package: string;
  mpn: string;
  lcsc: string;
  manufacturer: string;
  fitted: boolean;
}

/** The rules check's and the board check's results, as a script reads them. */
export interface ScriptCheck {
  level: "error" | "warning";
  rule: string;
  text: string;
}

/** Checks the editor runs, handed in by whoever runs the script (they are large, and the API doesn't need them). */
export interface ScriptChecks {
  erc?: (d: ElectronicsDesign) => ScriptCheck[];
  drc?: (d: ElectronicsDesign) => ScriptCheck[];
}

/** The most changes and output a run may make, so a runaway loop ends with a message rather than a stuck page. */
export const SCRIPT_LIMIT = 10_000;

const RULES: RuleField[] = [
  "clearance",
  "trackWidth",
  "minTrackWidth",
  "viaDiameter",
  "viaDrill",
  "minDrill",
  "minRing",
  "minViaRing",
  "holeToHole",
  "copperToEdge",
  "minSilkWidth",
  "minSilkHeight",
  "maskMargin",
];

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const num = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${what} must be a number`);
  return v;
};
const str = (v: unknown, what: string): string => {
  if (typeof v !== "string") throw new Error(`${what} must be text`);
  return v;
};
const point = (v: unknown, what: string): P2 => {
  if (!Array.isArray(v) || v.length !== 2) throw new Error(`${what} must be a point, such as [10, 5]`);
  return [num(v[0], what), num(v[1], what)];
};

/** Makes the `bc` object for one run on a copy of the design. */
export function scriptApi(d: ElectronicsDesign, checks: ScriptChecks = {}) {
  const changes: ScriptChange[] = [];
  const output: ScriptOutput[] = [];
  const refs = new Set(d.parts.map((p) => p.ref));
  const sheets = new Map(d.sheets.map((s) => [s.id, s]));
  const nets = new Set(netlist(d).nets.map((n) => n.name));
  const count = () => {
    if (changes.length + output.length >= SCRIPT_LIMIT) throw new Error(`A script can make at most ${SCRIPT_LIMIT} changes and lines`);
  };
  const change = (c: ScriptChange) => {
    count();
    changes.push(c);
  };
  const part = (ref: unknown) => {
    const r = str(ref, "A part's reference");
    if (!refs.has(r)) throw new Error(`There is no part ${r}`);
    return r;
  };
  const sheet = (id: unknown) => {
    const s = id === undefined ? d.sheets[0]?.id : str(id, "A sheet");
    // A sheet by its id or its name.
    const found = (s && sheets.get(s)) ?? d.sheets.find((x) => x.name === s);
    if (!found) throw new Error(`There is no sheet ${String(id)}`);
    return found.id;
  };
  const net = (name: unknown) => {
    const n = str(name, "A net's name");
    if (!nets.has(n)) throw new Error(`There is no net ${n}`);
    return n;
  };
  const needBoard = () => {
    if (!d.board) throw new Error("There is no board yet: push the schematic to a PCB first");
  };
  let placed = 0;

  const bc = Object.freeze({
    parts: (): ScriptPart[] =>
      d.parts
        .filter((p) => !isPower(d, p))
        .sort((a, b) => byRef(a.ref, b.ref))
        .map((p) => {
          const def = defOf(d, p);
          return {
            ref: p.ref,
            value: p.value,
            name: def?.name ?? "",
            prefix: def?.prefix ?? "",
            package: def?.packages[p.pkg]?.footprint.name ?? "",
            mpn: p.supplier?.mpn ?? "",
            lcsc: p.supplier?.lcsc ?? "",
            manufacturer: p.supplier?.manufacturer ?? "",
            fitted: p.fitted !== false,
          };
        }),
    sheets: () =>
      d.sheets.map((s) => ({
        id: s.id,
        name: s.name,
        labels: s.labels.map((l) => ({ name: l.name, x: l.x, y: l.y })),
        parts: [...new Set(s.symbols.map((y) => d.parts.find((p) => p.id === y.part)?.ref).filter((r): r is string => !!r))].sort(byRef),
      })),
    nets: () => netlist(d).nets.map((n) => ({ name: n.name, pins: [...new Set(n.pins.map((p) => `${p.ref}:${p.pin}`))] })),
    board: () => {
      const b = d.board;
      if (!b) return null;
      const ref = new Map(d.parts.map((p) => [p.id, p.ref]));
      return copy({
        outline: b.outline.map((c) => [c.x, c.y]),
        placements: b.placements.map((p) => ({ ref: ref.get(p.part) ?? "", x: p.x, y: p.y, rot: p.rot, side: p.side, locked: !!p.locked })),
        tracks: b.tracks.map((t) => ({ net: t.net, layer: t.layer, width: t.width, pts: t.pts })),
        vias: b.vias.map((v) => ({ net: v.net, x: v.x, y: v.y, diameter: v.diameter, drill: v.drill })),
        pours: b.pours.map((p) => ({ net: p.net, layer: p.layer, outline: p.outline })),
        rules: b.rules,
        classes: b.classes.map((c) => ({ name: c.name, nets: c.nets, trackWidth: c.trackWidth, clearance: c.clearance })),
      });
    },
    erc: (): ScriptCheck[] => copy(checks.erc?.(d) ?? []),
    drc: (): ScriptCheck[] => copy(d.board ? (checks.drc?.(d) ?? []) : []),

    setValue: (ref: string, value: string) => change({ kind: "value", ref: part(ref), value: str(value, "A value") }),
    setFitted: (ref: string, fitted: boolean) => change({ kind: "fitted", ref: part(ref), fitted: !!fitted }),
    setPartNumber: (ref: string, numbers: { mpn?: string; lcsc?: string; manufacturer?: string }) => {
      const supplier: Supplier = {};
      for (const k of ["mpn", "lcsc", "manufacturer"] as const) if (numbers?.[k] !== undefined) supplier[k] = str(numbers[k], `The ${k}`);
      change({ kind: "partNumber", ref: part(ref), supplier });
    },
    renumber: () => change({ kind: "renumber" }),
    addLabel: (name: string, at: P2, onSheet?: string) => {
      const [x, y] = point(at, "Where the label goes");
      change({ kind: "label", sheet: sheet(onSheet), name: str(name, "A label's name"), x, y });
    },
    /** Places another part like `like` (its component and package), on a sheet; it is numbered when kept. */
    place: (like: string, at: P2, opts: { sheet?: string; rot?: number; value?: string } = {}) => {
      const [x, y] = point(at, "Where the part goes");
      const rot = (((Math.round(num(opts.rot ?? 0, "A turn") / 90) * 90) % 360) + 360) % 360;
      placed += 1;
      change({
        kind: "place",
        like: part(like),
        sheet: sheet(opts.sheet),
        x,
        y,
        rot: rot as 0 | 90 | 180 | 270,
        ...(opts.value !== undefined ? { value: str(opts.value, "A value") } : {}),
      });
      return placed;
    },
    wire: (a: P2, b: P2, onSheet?: string) => change({ kind: "wire", sheet: sheet(onSheet), a: point(a, "A wire's start"), b: point(b, "A wire's end") }),
    move: (ref: string, at: P2, rot?: number, side?: Side) => {
      needBoard();
      const r = part(ref);
      if (!d.board!.placements.some((p) => d.parts.find((q) => q.id === p.part)?.ref === r)) throw new Error(`${r} isn't on the board yet`);
      if (side !== undefined && side !== "top" && side !== "bottom") throw new Error('A side is "top" or "bottom"');
      const [x, y] = point(at, "Where the part goes");
      change({ kind: "move", ref: r, x, y, ...(rot !== undefined ? { rot: num(rot, "A turn") } : {}), ...(side ? { side } : {}) });
    },
    addTrack: (onNet: string, pts: P2[], opts: { layer?: CopperLayer; width?: number } = {}) => {
      needBoard();
      if (!Array.isArray(pts) || pts.length < 2) throw new Error("A track needs two points or more");
      const layer = opts.layer ?? "top";
      if (!/^(top|bottom|in\d+)$/.test(layer)) throw new Error('A layer is "top", "bottom" or "in1"…');
      change({
        kind: "track",
        net: net(onNet),
        layer,
        pts: pts.map((p, i) => point(p, `Point ${i + 1} of the track`)),
        ...(opts.width !== undefined ? { width: num(opts.width, "A track's width") } : {}),
      });
    },
    addVia: (onNet: string, at: P2) => {
      needBoard();
      const [x, y] = point(at, "Where the via goes");
      change({ kind: "via", net: net(onNet), x, y });
    },
    setRule: (field: RuleField, value: number) => {
      needBoard();
      if (!RULES.includes(field)) throw new Error(`There is no rule ${String(field)}; the rules are ${RULES.join(", ")}`);
      change({ kind: "rule", field, value: num(value, "A rule") });
    },
    setNetClass: (onNet: string, cls: string | null) => (
      needBoard(),
      change({ kind: "netClass", net: net(onNet), cls: cls === null ? null : str(cls, "A class's name") })
    ),

    say: (...parts: unknown[]) => {
      count();
      output.push({ kind: "say", text: parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ") });
    },
    table: (rows: unknown[][]) => {
      count();
      if (!Array.isArray(rows)) throw new Error("A table is a list of rows");
      output.push({ kind: "table", rows: rows.map((r) => (Array.isArray(r) ? r : [r]).map((c) => (c === null || c === undefined ? "" : String(c)))) });
    },
    file: (name: string, text: string) => {
      count();
      output.push({ kind: "file", name: str(name, "A file's name").replace(/[\\/]/g, "-"), text: str(text, "A file's text") });
    },
  });
  return { bc, changes, output };
}

export type ScriptApi = ReturnType<typeof scriptApi>["bc"];

/** Applies a run's changes, in order, through the editor's edit functions. */
export function applyScript(start: ElectronicsDesign, changes: ScriptChange[]): ElectronicsDesign {
  let d = start;
  const idOf = (ref: string) => d.parts.find((p) => p.ref === ref)?.id;
  for (const c of changes) {
    const id = "ref" in c ? idOf(c.ref) : undefined;
    switch (c.kind) {
      case "value":
        if (id) d = changePart(d, id, { value: c.value });
        break;
      case "fitted":
        if (id) d = changePart(d, id, { fitted: c.fitted });
        break;
      case "partNumber":
        if (id) d = setSupplier(d, [id], c.supplier);
        break;
      case "renumber":
        d = renumber(d);
        break;
      case "label":
        d = addLabel(d, c.sheet, c.name, c.x, c.y);
        break;
      case "place": {
        const like = d.parts.find((p) => p.ref === c.like);
        const def = like && defOf(d, like);
        if (like && def) d = placePart(d, c.sheet, def, { x: c.x, y: c.y, rot: c.rot }, { value: c.value ?? like.value, pkg: like.pkg }).design;
        break;
      }
      case "wire":
        d = addWire(d, c.sheet, c.a, c.b);
        break;
      case "move":
        if (id) d = setPlacement(d, id, { x: c.x, y: c.y, ...(c.rot !== undefined ? { rot: c.rot } : {}), ...(c.side ? { side: c.side } : {}) });
        break;
      case "track":
        d = addTrack(d, c.net, c.layer, c.pts, c.width);
        break;
      case "via":
        d = addVia(d, c.net, c.x, c.y);
        break;
      case "rule":
        d = setRule(d, c.field, c.value);
        break;
      case "netClass": {
        if (!d.board) break;
        if (c.cls === null) d = setNetClass(d, c.net, null);
        else {
          const found = d.board.classes.find((k) => k.name === c.cls);
          d = found ? setNetClass(d, c.net, found.id) : addNetClass(d, c.net, c.cls).design;
        }
        break;
      }
    }
  }
  return d;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A run's changes in words, for the preview: "Moves 16 parts, adds 2 tracks, sets C3 to 100 nF". */
export function describeChanges(changes: ScriptChange[]): string {
  if (!changes.length) return "Changes nothing";
  const by = <K extends ScriptChange["kind"]>(k: K) => changes.filter((c): c is Extract<ScriptChange, { kind: K }> => c.kind === k);
  const out: string[] = [];
  const moved = new Set(by("move").map((c) => c.ref)).size;
  if (moved) out.push(`moves ${plural(moved, "part")}`);
  const placed = by("place").length;
  if (placed) out.push(`places ${plural(placed, "part")}`);
  const values = by("value");
  if (values.length === 1) out.push(`sets ${values[0]!.ref} to ${values[0]!.value}`);
  else if (values.length) out.push(`sets ${plural(new Set(values.map((c) => c.ref)).size, "value")}`);
  const fitted = by("fitted");
  const off = fitted.filter((c) => !c.fitted).length;
  if (off) out.push(`leaves off ${plural(off, "part")}`);
  if (fitted.length - off) out.push(`fits ${plural(fitted.length - off, "part")}`);
  const numbers = by("partNumber").length;
  if (numbers) out.push(`sets ${plural(numbers, "part number")}`);
  if (by("renumber").length) out.push("numbers the parts again");
  const labels = by("label").length;
  if (labels) out.push(`adds ${plural(labels, "label")}`);
  const wires = by("wire").length;
  if (wires) out.push(`adds ${plural(wires, "wire")}`);
  const tracks = by("track").length;
  if (tracks) out.push(`adds ${plural(tracks, "track")}`);
  const vias = by("via").length;
  if (vias) out.push(`adds ${plural(vias, "via")}`);
  const rules = by("rule").length;
  if (rules) out.push(`changes ${plural(rules, "rule")}`);
  const classes = by("netClass").length;
  if (classes) out.push(`puts ${plural(classes, "net")} in a class`);
  const text = out.join(", ");
  return text[0]!.toUpperCase() + text.slice(1);
}

/** The editor's part ids a run's changes touch, to light them up in the preview. */
export function touchedParts(d: ElectronicsDesign, changes: ScriptChange[]): Id[] {
  const refs = new Set(changes.flatMap((c) => ("ref" in c ? [c.ref] : [])));
  return d.parts.filter((p) => refs.has(p.ref)).map((p) => p.id);
}

/**
 * A run's changes and output as they came back from the sandbox, kept only where each is the shape the API makes.
 * A script can't reach this side, but it can tamper with its own worker, so nothing it sends is taken on trust.
 */
export function cleanRun(changes: unknown, output: unknown): { changes: ScriptChange[]; output: ScriptOutput[] } {
  const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const isStr = (v: unknown): v is string => typeof v === "string" && v.length < 100_000;
  const isPt = (v: unknown): v is P2 => Array.isArray(v) && v.length === 2 && v.every(isNum);
  const ok = (c: Record<string, unknown>): boolean => {
    switch (c.kind) {
      case "value":
        return isStr(c.ref) && isStr(c.value);
      case "fitted":
        return isStr(c.ref) && typeof c.fitted === "boolean";
      case "partNumber":
        return (
          isStr(c.ref) &&
          !!c.supplier &&
          typeof c.supplier === "object" &&
          Object.entries(c.supplier).every(([k, v]) => ["mpn", "lcsc", "manufacturer"].includes(k) && isStr(v))
        );
      case "renumber":
        return true;
      case "label":
        return isStr(c.sheet) && isStr(c.name) && isNum(c.x) && isNum(c.y);
      case "place":
        return (
          isStr(c.like) &&
          isStr(c.sheet) &&
          isNum(c.x) &&
          isNum(c.y) &&
          [0, 90, 180, 270].includes(c.rot as number) &&
          (c.value === undefined || isStr(c.value))
        );
      case "wire":
        return isStr(c.sheet) && isPt(c.a) && isPt(c.b);
      case "move":
        return (
          isStr(c.ref) && isNum(c.x) && isNum(c.y) && (c.rot === undefined || isNum(c.rot)) && (c.side === undefined || c.side === "top" || c.side === "bottom")
        );
      case "track":
        return (
          isStr(c.net) &&
          isStr(c.layer) &&
          /^(top|bottom|in\d+)$/.test(c.layer) &&
          Array.isArray(c.pts) &&
          c.pts.length >= 2 &&
          c.pts.every(isPt) &&
          (c.width === undefined || (isNum(c.width) && c.width > 0))
        );
      case "via":
        return isStr(c.net) && isNum(c.x) && isNum(c.y);
      case "rule":
        return RULES.includes(c.field as RuleField) && isNum(c.value);
      case "netClass":
        return isStr(c.net) && (c.cls === null || isStr(c.cls));
      default:
        return false;
    }
  };
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, SCRIPT_LIMIT) : []).filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  const cleanOut = (o: Record<string, unknown>): ScriptOutput | null => {
    if (o.kind === "say" && isStr(o.text)) return { kind: "say", text: o.text };
    if (o.kind === "file" && isStr(o.name) && typeof o.text === "string") return { kind: "file", name: o.name.replace(/[\\/]/g, "-"), text: o.text };
    if (o.kind === "table" && Array.isArray(o.rows))
      return { kind: "table", rows: o.rows.filter(Array.isArray).map((r: unknown[]) => r.map((c) => String(c))) };
    return null;
  };
  return {
    changes: list(changes).filter(ok) as unknown as ScriptChange[],
    output: list(output)
      .map(cleanOut)
      .filter((o): o is ScriptOutput => !!o),
  };
}
