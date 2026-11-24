import { distToSegment } from "../geom";
import { pointInPolygon } from "../outlineGeom";
import type { P2 } from "../model";

/**
 * A small reader for Gerber and Excellon files (#657). The preview and the tests read back the files that were
 * written, so they show what a board house will see, not what the design says. It reads what board tools write:
 * RS-274X in millimetres or inches, standard apertures, aperture macros with sums, arcs, areas and dark and clear
 * polarity. Step and repeat and aperture blocks are not read; `skipped` says when a file used them.
 */
export type Prim = { kind: "disc"; d: number; at: P2; dark: boolean } | { kind: "poly"; pts: P2[]; dark: boolean };
export type Aperture =
  { kind: "circle"; d: number } | { kind: "rect"; w: number; h: number } | { kind: "obround"; w: number; h: number } | { kind: "macro"; prims: Prim[] };

export type GerberOp = { dark: boolean } & ({ kind: "flash"; ap: Aperture; at: P2 } | { kind: "draw"; pen: number; pts: P2[] } | { kind: "region"; pts: P2[] });

export interface GerberImage {
  ops: GerberOp[];
  /** The file's .FileFunction attribute, if it has one: "Copper,L1,Top". */
  fn?: string;
  skipped: string[];
  box: { x1: number; y1: number; x2: number; y2: number } | null;
}

/** A macro's sums: numbers, $n, + - x / and brackets. */
function sum(expr: string, vars: number[]): number {
  let i = 0;
  const s = expr.replace(/\s+/g, "");
  const atom = (): number => {
    if (s[i] === "(") {
      i += 1;
      const v = add();
      i += 1;
      return v;
    }
    if (s[i] === "-") {
      i += 1;
      return -atom();
    }
    if (s[i] === "+") {
      i += 1;
      return atom();
    }
    if (s[i] === "$") {
      const m = /^\$(\d+)/.exec(s.slice(i))!;
      i += m[0].length;
      return vars[Number(m[1]) - 1] ?? 0;
    }
    const m = /^\d*\.?\d+/.exec(s.slice(i));
    if (!m) return 0;
    i += m[0].length;
    return Number(m[0]);
  };
  const mul = (): number => {
    let v = atom();
    while (s[i] === "x" || s[i] === "X" || s[i] === "/") {
      const op = s[i];
      i += 1;
      const r = atom();
      v = op === "/" ? v / r : v * r;
    }
    return v;
  };
  const add = (): number => {
    let v = mul();
    while (s[i] === "+" || s[i] === "-") {
      const op = s[i];
      i += 1;
      const r = mul();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  return add();
}

const spin = (p: P2, deg: number): P2 => {
  const a = (deg * Math.PI) / 180;
  return [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
};

/** A macro's body, worked out for one aperture's numbers. */
function macro(body: string[], args: number[]): Prim[] {
  const vars = [...args];
  const out: Prim[] = [];
  for (const line of body) {
    const set = /^\$(\d+)=(.*)$/.exec(line);
    if (set) {
      vars[Number(set[1]) - 1] = sum(set[2]!, vars);
      continue;
    }
    if (line.startsWith("0")) continue;
    const n = line.split(",").map((x) => sum(x, vars));
    const dark = n[1] !== 0;
    if (n[0] === 1) out.push({ kind: "disc", d: n[2]!, at: spin([n[3]!, n[4]!], n[5] ?? 0), dark });
    else if (n[0] === 20) {
      const [w, x1, y1, x2, y2, rot] = n.slice(2) as [number, number, number, number, number, number];
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const [nx, ny] = [(-(y2 - y1) / len) * (w / 2), ((x2 - x1) / len) * (w / 2)];
      out.push({
        kind: "poly",
        pts: (
          [
            [x1 + nx, y1 + ny],
            [x2 + nx, y2 + ny],
            [x2 - nx, y2 - ny],
            [x1 - nx, y1 - ny],
          ] as P2[]
        ).map((p) => spin(p, rot ?? 0)),
        dark,
      });
    } else if (n[0] === 21) {
      const [w, h, cx, cy, rot] = n.slice(2) as [number, number, number, number, number];
      out.push({
        kind: "poly",
        pts: (
          [
            [cx - w / 2, cy - h / 2],
            [cx + w / 2, cy - h / 2],
            [cx + w / 2, cy + h / 2],
            [cx - w / 2, cy + h / 2],
          ] as P2[]
        ).map((p) => spin(p, rot ?? 0)),
        dark,
      });
    } else if (n[0] === 4) {
      const count = n[2]!;
      const pts: P2[] = [];
      for (let k = 0; k < count; k += 1) pts.push([n[3 + 2 * k]!, n[4 + 2 * k]!]);
      const rot = n[5 + 2 * count] ?? 0;
      out.push({ kind: "poly", pts: pts.map((p) => spin(p, rot)), dark });
    } else if (n[0] === 5) {
      const [count, cx, cy, d, rot] = n.slice(2) as [number, number, number, number, number];
      const pts: P2[] = [];
      for (let k = 0; k < count; k += 1) pts.push([cx + (d / 2) * Math.cos((2 * Math.PI * k) / count), cy + (d / 2) * Math.sin((2 * Math.PI * k) / count)]);
      out.push({ kind: "poly", pts: pts.map((p) => spin(p, rot ?? 0)), dark });
    }
  }
  return out;
}

/** An arc as short straight runs, from `a` to `b` about `c`. Equal ends make a full circle. */
function arcPoints(a: P2, b: P2, c: P2, clockwise: boolean): P2[] {
  const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  let sweep = Math.atan2(b[1] - c[1], b[0] - c[0]) - a0;
  if (clockwise && sweep >= -1e-12) sweep -= 2 * Math.PI;
  if (!clockwise && sweep <= 1e-12) sweep += 2 * Math.PI;
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / (2 * Math.acos(Math.max(0, 1 - 0.005 / Math.max(r, 0.005))))));
  const out: P2[] = [];
  for (let k = 1; k < n; k += 1) out.push([c[0] + r * Math.cos(a0 + (sweep * k) / n), c[1] + r * Math.sin(a0 + (sweep * k) / n)]);
  out.push(b);
  return out;
}

export function readGerber(text: string): GerberImage {
  const ops: GerberOp[] = [];
  const skipped = new Set<string>();
  const aps = new Map<number, Aperture>();
  const macros = new Map<string, string[]>();
  let fn: string | undefined;
  let unit = 1;
  let decimals = 6;
  let ap: Aperture | undefined;
  let dark = true;
  let mode: 1 | 2 | 3 = 1;
  let at: P2 = [0, 0];
  let region: P2[] | null = null;
  let path: P2[] = [];

  const endPath = () => {
    if (region) {
      if (path.length > 2) ops.push({ kind: "region", pts: path, dark });
    } else if (path.length > 1 && ap) {
      const pen = ap.kind === "circle" ? ap.d : ap.kind === "macro" ? 0 : Math.min(ap.w, ap.h);
      ops.push({ kind: "draw", pen, pts: path, dark });
    }
    path = [];
  };

  // Split into extended commands (%...%) and plain ones, each ending in a star.
  const tokens: { ext: boolean; body: string }[] = [];
  for (const m of text.matchAll(/%([^%]*)%|([^%*]+)\*/g)) tokens.push(m[1] !== undefined ? { ext: true, body: m[1] } : { ext: false, body: m[2]!.trim() });

  for (const t of tokens) {
    if (t.ext) {
      const parts = t.body
        .split("*")
        .map((x) => x.replace(/\s+/g, ""))
        .filter(Boolean);
      const head = parts[0] ?? "";
      if (head.startsWith("FS")) {
        const m = /X(\d)(\d)/.exec(head);
        if (m) decimals = Number(m[2]);
      } else if (head.startsWith("MO")) unit = head.includes("IN") ? 25.4 : 1;
      else if (head.startsWith("TF.FileFunction,")) fn = t.body.replace(/\*$/, "").split("TF.FileFunction,")[1]?.replace(/\*.*$/, "");
      else if (head.startsWith("AM")) macros.set(head.slice(2), parts.slice(1));
      else if (head.startsWith("AD")) {
        const m = /^ADD(\d+)([^,]+)(?:,(.*))?$/.exec(head);
        if (!m) continue;
        const args = (m[3] ?? "").split("X").filter(Boolean).map(Number);
        const scale = (v: number | undefined) => (v ?? 0) * unit;
        const kind = m[2]!;
        let made: Aperture;
        if (kind === "C") made = { kind: "circle", d: scale(args[0]) };
        else if (kind === "R") made = { kind: "rect", w: scale(args[0]), h: scale(args[1]) };
        else if (kind === "O") made = { kind: "obround", w: scale(args[0]), h: scale(args[1]) };
        else if (kind === "P") made = { kind: "macro", prims: macro([`5,1,${args[1]},0,0,${args[0]},${args[2] ?? 0}`], []) };
        else {
          const prims = macro(macros.get(kind) ?? [], args);
          made = {
            kind: "macro",
            prims: prims.map((p) =>
              p.kind === "disc"
                ? { ...p, d: p.d * unit, at: [p.at[0] * unit, p.at[1] * unit] }
                : { ...p, pts: p.pts.map(([x, y]): P2 => [x * unit, y * unit]) },
            ),
          };
        }
        aps.set(Number(m[1]), made);
      } else if (head.startsWith("LP")) {
        endPath();
        dark = head[2] !== "C";
      } else if (head.startsWith("SR") || head.startsWith("AB")) {
        if (head.length > 2) skipped.add(head.startsWith("SR") ? "step and repeat" : "aperture blocks");
      }
      continue;
    }
    let cmd = t.body;
    if (!cmd || cmd.startsWith("G04")) continue;
    // A G code can lead a command: G01X..., G54D10.
    const g = /^G0*(\d+)/.exec(cmd);
    if (g) {
      const code = Number(g[1]);
      cmd = cmd.slice(g[0].length);
      if (code === 1 || code === 2 || code === 3) mode = code;
      else if (code === 36) {
        endPath();
        region = [];
      } else if (code === 37) {
        endPath();
        region = null;
      } else if (code === 70) unit = 25.4;
      else if (code === 71) unit = 1;
      if (!cmd) continue;
    }
    if (/^M0*[02]/.test(cmd)) break;
    const sel = /^D0*(\d+)$/.exec(cmd);
    if (sel && Number(sel[1]) >= 10) {
      endPath();
      ap = aps.get(Number(sel[1]));
      continue;
    }
    const num = (k: string): number | undefined => {
      const m = new RegExp(`${k}([+-]?\\d+)`).exec(cmd);
      return m ? (Number(m[1]) / 10 ** decimals) * unit : undefined;
    };
    const op = /D0*([123])$/.exec(cmd);
    const to: P2 = [num("X") ?? at[0], num("Y") ?? at[1]];
    const d = op ? Number(op[1]) : 1;
    if (d === 2) {
      endPath();
      path = [to];
    } else if (d === 3) {
      endPath();
      if (ap) ops.push({ kind: "flash", ap, at: to, dark });
    } else {
      if (!path.length) path = [at];
      if (mode === 1) path.push(to);
      else path.push(...arcPoints(at, to, [at[0] + (num("I") ?? 0), at[1] + (num("J") ?? 0)], mode === 2));
    }
    at = to;
  }
  endPath();

  let box: GerberImage["box"] = null;
  const grow = (p: P2, by: number) => {
    box = box
      ? { x1: Math.min(box.x1, p[0] - by), y1: Math.min(box.y1, p[1] - by), x2: Math.max(box.x2, p[0] + by), y2: Math.max(box.y2, p[1] + by) }
      : { x1: p[0] - by, y1: p[1] - by, x2: p[0] + by, y2: p[1] + by };
  };
  for (const o of ops) {
    if (!o.dark) continue;
    if (o.kind === "flash") grow(o.at, apertureReach(o.ap));
    else for (const p of o.pts) grow(p, o.kind === "draw" ? o.pen / 2 : 0);
  }
  return { ops, ...(fn ? { fn } : {}), skipped: [...skipped], box };
}

/** How far an aperture reaches from its middle. */
export function apertureReach(ap: Aperture): number {
  if (ap.kind === "circle") return ap.d / 2;
  if (ap.kind === "rect" || ap.kind === "obround") return Math.hypot(ap.w, ap.h) / 2;
  let r = 0;
  for (const p of ap.prims) r = Math.max(r, p.kind === "disc" ? Math.hypot(p.at[0], p.at[1]) + p.d / 2 : Math.max(...p.pts.map((q) => Math.hypot(q[0], q[1]))));
  return r;
}

/** Whether an aperture flashed at the origin covers a point. */
function covers(ap: Aperture, x: number, y: number): boolean {
  if (ap.kind === "circle") return Math.hypot(x, y) <= ap.d / 2;
  if (ap.kind === "rect") return Math.abs(x) <= ap.w / 2 && Math.abs(y) <= ap.h / 2;
  if (ap.kind === "obround") {
    const r = Math.min(ap.w, ap.h) / 2;
    const half = Math.max(ap.w, ap.h) / 2 - r;
    return ap.w >= ap.h ? distToSegment([x, y], [-half, 0], [half, 0]) <= r : distToSegment([x, y], [0, -half], [0, half]) <= r;
  }
  let on = false;
  for (const p of ap.prims) if (p.kind === "disc" ? Math.hypot(x - p.at[0], y - p.at[1]) <= p.d / 2 : pointInPolygon([x, y], p.pts)) on = p.dark;
  return on;
}

/** Whether a file leaves a mark at a point: its operations in order, the last one over the point winning. */
export function inkAt(image: Pick<GerberImage, "ops">, p: P2): boolean {
  let on = false;
  for (const o of image.ops) {
    let hit = false;
    if (o.kind === "flash") hit = covers(o.ap, p[0] - o.at[0], p[1] - o.at[1]);
    else if (o.kind === "region") hit = pointInPolygon(p, o.pts);
    else for (let i = 0; i + 1 < o.pts.length && !hit; i += 1) hit = distToSegment(p, o.pts[i]!, o.pts[i + 1]!) <= o.pen / 2;
    if (hit) on = o.dark;
  }
  return on;
}

export interface DrillHit {
  /** Finished diameter, mm. */
  d: number;
  at: P2;
  /** The far end of a slot. */
  to?: P2;
}

/** Reads an Excellon drill file: tools, hits and slots, in millimetres. */
export function readDrill(text: string): { hits: DrillHit[]; plated: boolean | null } {
  const tools = new Map<number, number>();
  const hits: DrillHit[] = [];
  let unit = 1;
  let tool = 0;
  let header = true;
  let plated: boolean | null = null;
  let at: P2 = [0, 0];
  let routing = false;
  let from: P2 | null = null;
  const num = (line: string, k: string, prev: number): number => {
    const m = new RegExp(`${k}([+-]?[\\d.]+)`).exec(line);
    if (!m) return prev;
    // A number with no point is thousandths of a millimetre, or ten-thousandths of an inch.
    return (m[1]!.includes(".") ? Number(m[1]) : Number(m[1]) / (unit === 1 ? 1000 : 10000)) * unit;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith(";")) {
      if (/NPTH|NonPlated/i.test(line)) plated = false;
      else if (/PTH|Plated/i.test(line)) plated = plated ?? true;
      continue;
    }
    if (line === "%" || line === "M95") {
      header = false;
      continue;
    }
    if (/^METRIC/.test(line) || line === "M71") unit = 1;
    else if (/^INCH/.test(line) || line === "M72") unit = 25.4;
    const def = /^T(\d+).*?C([\d.]+)/.exec(line);
    if (def) {
      tools.set(Number(def[1]), Number(def[2]) * unit);
      continue;
    }
    if (header) continue;
    const sel = /^T(\d+)$/.exec(line);
    if (sel) {
      tool = Number(sel[1]);
      continue;
    }
    if (line === "M30" || line === "M00") break;
    if (line === "M15") {
      routing = true;
      from = at;
      continue;
    }
    if (line === "M16" || line === "M17") {
      routing = false;
      from = null;
      continue;
    }
    if (!/[XY]/.test(line)) continue;
    const d = tools.get(tool) ?? 0;
    const slot = /^(.*)G85(.*)$/.exec(line);
    if (slot) {
      const a: P2 = [num(slot[1]!, "X", at[0]), num(slot[1]!, "Y", at[1])];
      const b: P2 = [num(slot[2]!, "X", a[0]), num(slot[2]!, "Y", a[1])];
      hits.push({ d, at: a, to: b });
      at = b;
      continue;
    }
    const to: P2 = [num(line, "X", at[0]), num(line, "Y", at[1])];
    if (line.startsWith("G00")) at = to;
    else if (routing && line.startsWith("G01")) {
      hits.push({ d, at: from ?? at, to });
      from = to;
      at = to;
    } else {
      hits.push({ d, at: to });
      at = to;
    }
  }
  return { hits, plated };
}
