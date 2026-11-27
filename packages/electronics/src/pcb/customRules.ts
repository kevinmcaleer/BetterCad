import { eid, type Board, type BoardRule, type ElectronicsDesign, type Id, type P2 } from "../model";
import { child, children, isList, parseSexpr, text, type Node } from "../kicad/sexpr";

/**
 * Custom rules (#760): a clearance, or a track width, inside a drawn area, or a clearance between two net classes.
 * `clearanceBetween` and `netRules` in `./copper` apply them, so the board check, pours and the route tools follow
 * them. This holds the edits, and the reader for KiCad's simplest rules.
 */

const onBoard = (d: ElectronicsDesign, change: (b: Board) => Board): ElectronicsDesign => (d.board ? { ...d, board: change(d.board) } : d);

const withRules = (b: Board, rules: BoardRule[]): Board => {
  const out: Board = { ...b, customRules: rules };
  if (!rules.length) delete out.customRules;
  return out;
};

/** A rectangle, for an area drawn by its corners. */
export const areaRect = (x1: number, y1: number, x2: number, y2: number): P2[] => [
  [Math.min(x1, x2), Math.min(y1, y2)],
  [Math.max(x1, x2), Math.min(y1, y2)],
  [Math.max(x1, x2), Math.max(y1, y2)],
  [Math.min(x1, x2), Math.max(y1, y2)],
];

/** Adds a rule: between two classes, or over an area (a 10 mm square in the board's middle unless one is given). */
export function addRule(d: ElectronicsDesign, kind: BoardRule["kind"], area?: P2[]): { design: ElectronicsDesign; id: Id } {
  const id = eid("rule");
  const b = d.board;
  if (!b) return { design: d, id };
  const xs = b.outline.map((c) => c.x);
  const ys = b.outline.map((c) => c.y);
  const mid: P2 = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const n = (b.customRules ?? []).length + 1;
  const rule: BoardRule =
    kind === "area"
      ? { id, name: `Area ${n}`, kind, area: area ?? areaRect(mid[0] - 5, mid[1] - 5, mid[0] + 5, mid[1] + 5), clearance: b.rules.clearance }
      : { id, name: `Classes ${n}`, kind, a: b.classes[0]?.name ?? "Default", b: "Default", clearance: b.rules.clearance * 2 };
  return { design: onBoard(d, (x) => withRules(x, [...(x.customRules ?? []), rule])), id };
}

/** Changes a rule. A number set to undefined goes back to the classes' own. */
export function changeRule(d: ElectronicsDesign, id: Id, change: Partial<Omit<BoardRule, "id" | "kind">>): ElectronicsDesign {
  return onBoard(d, (b) =>
    withRules(
      b,
      (b.customRules ?? []).map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...change };
        for (const k of ["clearance", "trackWidth"] as const) if (next[k] === undefined) delete next[k];
        return next;
      }),
    ),
  );
}

export const removeRule = (d: ElectronicsDesign, id: Id): ElectronicsDesign =>
  onBoard(d, (b) =>
    withRules(
      b,
      (b.customRules ?? []).filter((r) => r.id !== id),
    ),
  );

// ---------------------------------------------------------------- KiCad

/** "0.3mm", "0.3", "12mil" in millimetres. */
const length = (v: string): number | null => {
  const m = /^(-?[\d.]+)\s*(mm|mil|in)?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "mil" ? n * 0.0254 : m[2] === "in" ? n * 25.4 : n;
};

export interface DruRead {
  rules: BoardRule[];
  /** Rules that ask for more than this reads: by name, and why. */
  skipped: { name: string; why: string }[];
}

/**
 * Reads KiCad's simplest custom rules (`.kicad_dru`): a clearance between two net classes
 * (`A.NetClass == 'HV' && B.NetClass == 'Default'`), and a clearance or track width inside a rule area
 * (`A.insideArea('BGA')`, or `intersectsArea`, `enclosedByArea`). `areas` gives each named rule area's outline,
 * from the board.
 */
export function readDru(src: string, areas: Map<string, P2[]>): DruRead {
  const out: DruRead = { rules: [], skipped: [] };
  let tree: Node[];
  try {
    tree = parseSexpr(`(dru ${src})`)[0] as Node[];
  } catch {
    return { rules: [], skipped: [{ name: "Rules", why: "The rules file could not be read" }] };
  }
  for (const r of children(tree, "rule")) {
    const name = text(r) || "Rule";
    const cond = (text(child(r, "condition")) || "").trim();
    const values: Partial<Record<"clearance" | "trackWidth", number>> = {};
    for (const c of children(r, "constraint")) {
      const kind = isList(c) ? String(c[1]) : "";
      const v = child(c, "min") ?? child(c, "opt");
      const mm = v ? length(String(v[1])) : null;
      if (mm === null) continue;
      if (kind === "clearance") values.clearance = mm;
      else if (kind === "track_width") values.trackWidth = child(c, "opt") ? length(String(child(c, "opt")![1]))! : mm;
    }
    if (values.clearance === undefined && values.trackWidth === undefined) {
      out.skipped.push({ name, why: "It sets something other than a clearance or a track width" });
      continue;
    }
    const pair = /^A\.NetClass\s*==\s*'([^']*)'\s*&&\s*B\.NetClass\s*==\s*'([^']*)'$/.exec(cond);
    const area = /^A\.(?:insideArea|intersectsArea|enclosedByArea)\(\s*'([^']*)'\s*\)$/.exec(cond);
    if (pair && values.clearance !== undefined)
      out.rules.push({ id: eid("rule"), name, kind: "classes", a: pair[1]!, b: pair[2]!, clearance: values.clearance });
    else if (area && areas.has(area[1]!)) out.rules.push({ id: eid("rule"), name, kind: "area", area: areas.get(area[1]!)!, ...values });
    else
      out.skipped.push({
        name,
        why: area ? `It names the area ${area[1]}, which is not on the board` : "Its condition is more than a pair of classes or an area",
      });
  }
  return out;
}
