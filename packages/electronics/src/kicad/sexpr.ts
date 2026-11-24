/**
 * KiCad's file format (#621): s-expressions. `(pad "1" smd rect (at 0 1.5))` reads as
 * `["pad", "1", "smd", "rect", ["at", "0", "1.5"]]`: a list is an array, everything else a string. Quoted strings
 * are wrapped in `Str` so a part named "hide" is never taken for the keyword.
 */
export class Str extends String {}
export type Node = string | Str | Node[];

/** Reads one file. Throws with the position when the brackets do not balance. */
export function parseSexpr(text: string): Node[] {
  const root: Node[] = [];
  const stack: Node[][] = [root];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text.charCodeAt(i);
    // Space, tab, newline, carriage return.
    if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
      i += 1;
    } else if (ch === 40) {
      const list: Node[] = [];
      stack[stack.length - 1]!.push(list);
      stack.push(list);
      i += 1;
    } else if (ch === 41) {
      if (stack.length === 1) throw new Error(`This is not a KiCad file: a ")" too many at character ${i}.`);
      stack.pop();
      i += 1;
    } else if (ch === 34) {
      let out = "";
      i += 1;
      let from = i;
      while (i < n && text.charCodeAt(i) !== 34) {
        if (text.charCodeAt(i) === 92) {
          out += text.slice(from, i);
          const e = text[i + 1];
          out += e === "n" ? "\n" : e === "t" ? "\t" : (e ?? "");
          i += 2;
          from = i;
        } else i += 1;
      }
      out += text.slice(from, i);
      i += 1;
      stack[stack.length - 1]!.push(new Str(out));
    } else {
      const from = i;
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 32 || c === 9 || c === 10 || c === 13 || c === 40 || c === 41) break;
        i += 1;
      }
      stack[stack.length - 1]!.push(text.slice(from, i));
    }
  }
  if (stack.length !== 1) throw new Error("This is not a whole KiCad file: it ends before its brackets close.");
  return root;
}

export const isList = (n: Node | undefined): n is Node[] => Array.isArray(n);
/** A list's keyword: `pad` for `(pad …)`. */
export const head = (n: Node | undefined): string => (isList(n) && typeof n[0] === "string" ? n[0] : "");
/** The first child list with this keyword. */
export const child = (n: Node[] | undefined, name: string): Node[] | undefined => n?.find((c): c is Node[] => head(c) === name);
export const children = (n: Node[] | undefined, name: string): Node[][] => (n ?? []).filter((c): c is Node[] => head(c) === name);
/** The text at a position of a list, quoted or not. */
export const text = (n: Node[] | undefined, at = 1): string => {
  const v = n?.[at];
  return v === undefined || isList(v) ? "" : String(v);
};
export const num = (n: Node[] | undefined, at = 1, or = 0): number => {
  const v = Number(text(n, at));
  return Number.isFinite(v) ? v : or;
};
/** Is a bare keyword among a list's items, or set by `(name yes)`? KiCad 8 moved from the first to the second. */
export const flag = (n: Node[] | undefined, name: string): boolean =>
  !!n && (n.some((c) => c === name) || text(child(n, name)) === "yes" || (child(n, name) !== undefined && child(n, name)!.length === 1));

/** Writes a tree back as text, for the exporters (#664). Lists with lists inside go one per line. */
export function writeSexpr(node: Node, indent = 0): string {
  if (!isList(node)) return node instanceof Str ? `"${String(node).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"` : node;
  const pad = "\t".repeat(indent);
  if (!node.some(isList)) return `(${node.map((c) => writeSexpr(c)).join(" ")})`;
  const flat: string[] = [];
  const nested: string[] = [];
  for (const c of node) (isList(c) ? nested : flat).push(isList(c) ? `${pad}\t${writeSexpr(c, indent + 1)}` : writeSexpr(c));
  return `(${flat.join(" ")}\n${nested.join("\n")}\n${pad})`;
}

/** Three points on an arc, as its centre, radius and the angles it runs between anticlockwise (y up). */
export function arcFrom3(a: [number, number], m: [number, number], b: [number, number]) {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a[0] * a[0] + a[1] * a[1];
  const m2 = m[0] * m[0] + m[1] * m[1];
  const b2 = b[0] * b[0] + b[1] * b[1];
  const cx = (a2 * (m[1] - b[1]) + m2 * (b[1] - a[1]) + b2 * (a[1] - m[1])) / d;
  const cy = (a2 * (b[0] - m[0]) + m2 * (a[0] - b[0]) + b2 * (m[0] - a[0])) / d;
  const deg = (p: [number, number]) => (Math.atan2(p[1] - cy, p[0] - cx) * 180) / Math.PI;
  // Anticlockwise from a to b when the end is to the left of the way from the start to the middle.
  const ccw = (m[0] - a[0]) * (b[1] - a[1]) - (m[1] - a[1]) * (b[0] - a[0]) > 0;
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;
  const [a0, a1] = ccw ? [deg(a), deg(b)] : [deg(b), deg(a)];
  return { cx: r4(cx), cy: r4(cy), r: r4(Math.hypot(a[0] - cx, a[1] - cy)), a0: r4(a0), a1: r4(a1 < a0 ? a1 + 360 : a1) };
}
