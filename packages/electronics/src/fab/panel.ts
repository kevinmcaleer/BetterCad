import { boardSize, outlinePoints } from "../board";
import { q } from "../geom";
import type { Board, P2 } from "../model";
import type { DrillFiles, Hole } from "./drill";
import { excellonFor } from "./drill";
import type { GerberFile } from "./gerber";

/**
 * Panels (#662): several copies of a board on one sheet, held by rails along two edges, parted by V-cuts or by tabs
 * with rows of small holes to snap along. The copies are written out in full in every file, not with Gerber's step
 * and repeat, so any viewer shows the panel as it will be made.
 */
export interface Panel {
  rows: number;
  cols: number;
  /** V-cuts: the boards touch and a groove is scored either side along each line. Tabs: a milled gap, bridged. */
  join: "vcut" | "tabs";
  /** Rails along the top and bottom of the panel, mm. 0 for none. */
  rail: number;
  /** The milled gap between boards held by tabs, mm. */
  gap: number;
}

export const PANEL: Panel = { rows: 2, cols: 2, join: "tabs", rail: 5, gap: 2 };

/** How wide a tab is, the holes along it, and the tooling holes in the rails, mm. Our own usual sizes. */
export const TAB = { width: 3, hole: 0.5, pitch: 0.8 };
export const TOOLING = { d: 2, in: 3 };

export interface PanelLayout {
  w: number;
  h: number;
  /** Where each copy's own origin goes: add it to every point of the board. Row by row from the bottom left. */
  offsets: P2[];
  /** V-cut lines, right across the panel. */
  cuts: [P2, P2][];
  /** The milled gap round boards held by tabs, mm; 0 for V-cuts. */
  gap: number;
  /** Tabs: the middle of each, the way it runs across the gap, and which ends of it meet a board (-1, 1 or both). */
  tabs: { at: P2; across: P2; boards: (-1 | 1)[] }[];
  /** Holes along each tab, on the board's edge, and the rails' tooling holes: none plated. */
  holes: Hole[];
}

const clampCount = (n: number) => Math.max(1, Math.min(20, Math.round(n) || 1));

/** Where the copies, cuts, tabs and holes go. */
export function panelLayout(board: Pick<Board, "outline">, panel: Panel): PanelLayout {
  const size = boardSize(board);
  const rows = clampCount(panel.rows);
  const cols = clampCount(panel.cols);
  const rail = Math.max(0, panel.rail);
  const tabs = panel.join === "tabs";
  const gap = tabs ? Math.max(0.5, panel.gap) : 0;
  // Tabs hold the boards off the rails by a gap too; V-cut boards sit right against them.
  const edge = tabs && rail > 0 ? gap : 0;
  const w = q(cols * size.w + (cols - 1) * gap);
  const h = q(rows * size.h + (rows - 1) * gap + 2 * (rail + edge));
  const offsets: P2[] = [];
  for (let r = 0; r < rows; r += 1)
    for (let c = 0; c < cols; c += 1) offsets.push([q(c * (size.w + gap) - size.x), q(rail + edge + r * (size.h + gap) - size.y)]);
  const cuts: [P2, P2][] = [];
  const held: PanelLayout["tabs"] = [];
  const holes: Hole[] = [];
  if (!tabs) {
    // Between the rows and against the rails; between the columns. Never along the panel's own outside.
    for (let r = rail > 0 ? 0 : 1; r <= (rail > 0 ? rows : rows - 1); r += 1) {
      const y = q(rail + r * size.h);
      cuts.push([
        [0, y],
        [w, y],
      ]);
    }
    for (let c = 1; c < cols; c += 1) {
      const x = q(c * size.w);
      cuts.push([
        [x, 0],
        [x, h],
      ]);
    }
  } else {
    // A tab in the middle of each side that faces another board or a rail; two on a side longer than 50 mm.
    const along = (len: number) => (len > 50 ? [len / 3, (2 * len) / 3] : [len / 2]);
    for (let r = 0; r < rows; r += 1)
      for (let c = 0; c < cols; c += 1) {
        const x0 = c * (size.w + gap);
        const y0 = rail + edge + r * (size.h + gap);
        for (const t of along(size.w)) {
          if (r > 0) held.push({ at: [q(x0 + t), q(y0 - gap / 2)], across: [0, 1], boards: [-1, 1] });
          else if (rail > 0) held.push({ at: [q(x0 + t), q(y0 - gap / 2)], across: [0, 1], boards: [1] });
          if (r === rows - 1 && rail > 0) held.push({ at: [q(x0 + t), q(y0 + size.h + gap / 2)], across: [0, 1], boards: [-1] });
        }
        if (c > 0) for (const t of along(size.h)) held.push({ at: [q(x0 - gap / 2), q(y0 + t)], across: [1, 0], boards: [-1, 1] });
      }
    // Each tab is drilled along the edge of each board it holds, so it snaps off clean.
    for (const t of held) {
      const side: P2 = [t.across[1], t.across[0]];
      const n = Math.max(2, Math.floor(TAB.width / TAB.pitch));
      for (const sign of t.boards) {
        const at: P2 = [t.at[0] + (sign * t.across[0] * gap) / 2, t.at[1] + (sign * t.across[1] * gap) / 2];
        for (let k = 0; k < n; k += 1) {
          const s = (k - (n - 1) / 2) * TAB.pitch;
          holes.push({ d: TAB.hole, at: [q(at[0] + side[0] * s), q(at[1] + side[1] * s)], plated: false, what: "hole" });
        }
      }
    }
  }
  if (rail >= TOOLING.d + 2)
    for (const y of [rail / 2, h - rail / 2])
      for (const x of [TOOLING.in, w - TOOLING.in]) holes.push({ d: TOOLING.d, at: [q(x), q(y)], plated: false, what: "hole" });
  return { w, h, offsets, gap, cuts, tabs: held, holes };
}

/** A Gerber file written out once for each copy, moved by its offset. Apertures are defined once, at the top. */
export function stepGerber(text: string, offsets: P2[]): string {
  const lines = text.split("\n");
  // Apertures are all defined before the first drawing: the body starts after the last definition.
  const last = lines.reduce((n, l, i) => (l.startsWith("%ADD") ? i : n), lines.indexOf("G75*"));
  const start = last + (lines[last - 1]?.startsWith("%TA.AperFunction") && lines[last + 1] === "%TD*%" ? 2 : 1);
  const end = lines.lastIndexOf("M02*");
  const head = lines.slice(0, start);
  const body = lines.slice(start, end);
  const move = (l: string, [dx, dy]: P2) =>
    l.replace(/^X(-?\d+)Y(-?\d+)/, (_, x: string, y: string) => `X${Math.round(Number(x) + dx * 1e6)}Y${Math.round(Number(y) + dy * 1e6)}`);
  const out = [...head];
  offsets.forEach((o, i) => {
    // Each copy starts as the first did: dark, with no object attributes left over.
    if (i > 0) out.push("%LPD*%", "%TD*%");
    out.push(`G04 Board ${i + 1} of ${offsets.length}*`);
    for (const l of body) out.push(move(l, o));
  });
  out.push("M02*", "");
  return out.join("\n");
}

/** The panel's outline: its own edge, and for tabs, each board's edge with a gap where each tab holds it. */
export function panelEdge(board: Pick<Board, "outline" | "cutouts">, layout: PanelLayout, fn = "Profile,NP"): string {
  const co = (n: number) => String(Math.round(n * 1e6));
  const body: string[] = ["D10*"];
  const run = (pts: P2[]) => {
    if (pts.length < 2) return;
    body.push(`X${co(pts[0]![0])}Y${co(pts[0]![1])}D02*`);
    for (const p of pts.slice(1)) body.push(`X${co(p[0])}Y${co(p[1])}D01*`);
  };
  run([[0, 0], [layout.w, 0], [layout.w, layout.h], [0, layout.h], [0, 0]]); // prettier-ignore
  if (layout.tabs.length)
    for (const o of layout.offsets)
      for (const loop of [board.outline, ...(board.cutouts ?? [])]) {
        const pts = outlinePoints(loop, 0.02).map((p): P2 => [p[0] + o[0], p[1] + o[1]]);
        // Fine steps, so a tab's gap falls where it should on a long straight side.
        const fine: P2[] = [];
        pts.forEach((a, i) => {
          const b = pts[(i + 1) % pts.length]!;
          const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25));
          for (let k = 0; k < n; k += 1) fine.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
        });
        let cur: P2[] = [];
        const outer = loop === board.outline;
        fine.forEach((a, i) => {
          const b = fine[(i + 1) % fine.length]!;
          if (outer && nearTab(layout, a, b)) {
            run(cur);
            cur = [];
          } else {
            if (!cur.length) cur.push(a);
            cur.push(b);
          }
        });
        run(cur);
      }
  return [
    "%TF.GenerationSoftware,BetterCad,BetterCad,1*%",
    "%TF.SameCoordinates,Original*%",
    `%TF.FileFunction,${fn}*%`,
    "%TF.FilePolarity,Positive*%",
    "%FSLAX46Y46*%",
    "%MOMM*%",
    "%LPD*%",
    "G01*",
    "G75*",
    "%TA.AperFunction,Profile*%",
    "%ADD10C,0.1*%",
    "%TD*%",
    ...body,
    "M02*",
    "",
  ].join("\n");
}

/** Whether a piece of a board's edge lies where a tab meets it: within half a tab along, and on the gap's side. */
function nearTab(layout: PanelLayout, a: P2, b: P2): boolean {
  const mid: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return layout.tabs.some((t) => {
    const side: P2 = [t.across[1], t.across[0]];
    const along = (mid[0] - t.at[0]) * side[0] + (mid[1] - t.at[1]) * side[1];
    const off = Math.abs((mid[0] - t.at[0]) * t.across[0] + (mid[1] - t.at[1]) * t.across[1]);
    // The piece runs along the side the tab holds.
    const runs = Math.abs((b[0] - a[0]) * t.across[0] + (b[1] - a[1]) * t.across[1]) < 1e-6;
    return runs && Math.abs(along) <= TAB.width / 2 && Math.abs(off - layout.gap / 2) <= 0.05;
  });
}

/** The V-cut lines as their own Gerber file, for a board house that wants them apart from the outline. */
export function vcutFile(layout: PanelLayout): string {
  const co = (n: number) => String(Math.round(n * 1e6));
  return [
    "%TF.GenerationSoftware,BetterCad,BetterCad,1*%",
    "%TF.FileFunction,Other,V-cut*%",
    "%FSLAX46Y46*%",
    "%MOMM*%",
    "%LPD*%",
    "G01*",
    "%ADD10C,0.1*%",
    "D10*",
    ...layout.cuts.flatMap(([a, b]) => [`X${co(a[0])}Y${co(a[1])}D02*`, `X${co(b[0])}Y${co(b[1])}D01*`]),
    "M02*",
    "",
  ].join("\n");
}

/** The panel's drill files: every copy's holes, the tabs' snap holes and the rails' tooling holes. */
export function panelDrills(drills: DrillFiles, layout: PanelLayout, layers: number): DrillFiles {
  const holes = layout.offsets.flatMap((o) =>
    drills.holes.map((h): Hole => ({ ...h, at: [q(h.at[0] + o[0]), q(h.at[1] + o[1])], ...(h.to ? { to: [q(h.to[0] + o[0]), q(h.to[1] + o[1])] } : {}) })),
  );
  return excellonFor([...holes, ...layout.holes], layers);
}

/** What the panel files are: every board file stepped, the outline and drills made for the panel. */
export function panelFiles(
  board: Pick<Board, "outline" | "cutouts">,
  panel: Panel,
  files: GerberFile[],
  drills: DrillFiles,
  layers: number,
): { layout: PanelLayout; gerbers: GerberFile[]; drills: DrillFiles; vcut: string | null } {
  const layout = panelLayout(board, panel);
  const gerbers = files.map((f) => (f.layer === "edge" ? { ...f, text: panelEdge(board, layout, f.fn) } : { ...f, text: stepGerber(f.text, layout.offsets) }));
  return { layout, gerbers, drills: panelDrills(drills, layout, layers), vcut: layout.cuts.length ? vcutFile(layout) : null };
}
