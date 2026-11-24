import { boardPads, type BoardPad } from "../board";
import { rad } from "../geom";
import type { ElectronicsDesign, P2 } from "../model";
import { netlist, type Netlist } from "../nets";

/**
 * Drill files (#656): Excellon in millimetres, plated and bare holes apart, as board houses ask. Sizes are finished
 * sizes. A slot is written as a routed slot: the tool goes down at one end, runs to the other and comes up. The
 * coordinates are the Gerbers' own, so the files overlay without an offset.
 */
export interface Hole {
  /** Finished diameter, mm. */
  d: number;
  at: P2;
  /** The far end of a slot's centre line. */
  to?: P2;
  plated: boolean;
  what: "pad" | "via" | "hole";
}

export interface DrillTool {
  tool: number;
  d: number;
  plated: boolean;
  holes: number;
  slots: number;
}

/** Every hole in the board. A pad's slot runs along the pad's own x, `drill` wide and `slot` long. */
export function holesOf(d: ElectronicsDesign, pads: BoardPad[] = boardPads(d)): Hole[] {
  const board = d.board;
  if (!board) return [];
  const out: Hole[] = [];
  for (const p of pads) {
    const drill = p.pad.drill;
    if (!drill || p.pad.kind === "smd") continue;
    const plated = p.pad.kind === "thru";
    const half = ((p.pad.slot ?? 0) - drill) / 2;
    if (half > 1e-6) {
      const [c, s] = [Math.cos(rad(p.angle)), Math.sin(rad(p.angle))];
      out.push({ d: drill, at: [p.at[0] - half * c, p.at[1] - half * s], to: [p.at[0] + half * c, p.at[1] + half * s], plated, what: "pad" });
    } else out.push({ d: drill, at: p.at, plated, what: "pad" });
  }
  for (const v of board.vias) out.push({ d: v.drill, at: [v.x, v.y], plated: true, what: "via" });
  for (const h of board.holes) out.push({ d: h.drill, at: [h.x, h.y], plated: !!h.pad, what: "hole" });
  return out;
}

const size = (n: number) => Math.round(n * 1000) / 1000;
const xy = (p: P2) => `X${size(p[0]).toFixed(3)}Y${size(p[1]).toFixed(3)}`;

/** The tools a set of holes needs, smallest first, numbered from `first`. */
function toolsFor(holes: Hole[], plated: boolean, first: number): DrillTool[] {
  const by = new Map<number, DrillTool>();
  for (const h of holes) {
    if (h.plated !== plated) continue;
    const d = size(h.d);
    const t = by.get(d) ?? { tool: 0, d, plated, holes: 0, slots: 0 };
    if (h.to) t.slots += 1;
    else t.holes += 1;
    by.set(d, t);
  }
  return [...by.values()].sort((a, b) => a.d - b.d).map((t, i) => ({ ...t, tool: first + i }));
}

function excellon(holes: Hole[], tools: DrillTool[], plated: boolean): string {
  const lines = [
    "M48",
    "; DRILL file {BetterCad}",
    "; FORMAT={-:-/ absolute / metric / decimal}",
    `; #@! TF.FileFunction,${plated ? "Plated,1,2,PTH" : "NonPlated,1,2,NPTH"}`,
    "FMAT,2",
    "METRIC",
    ...tools.map((t) => `T${t.tool}C${t.d.toFixed(3)}`),
    "%",
    "G90",
    "G05",
  ];
  for (const t of tools) {
    lines.push(`T${t.tool}`);
    const mine = holes.filter((h) => h.plated === plated && size(h.d) === t.d);
    for (const h of mine) if (!h.to) lines.push(xy(h.at));
    for (const h of mine) if (h.to) lines.push(`G00${xy(h.at)}`, "M15", `G01${xy(h.to)}`, "M16", "G05");
  }
  lines.push("M30", "");
  return lines.join("\n");
}

export interface DrillFiles {
  /** Plated holes: through pads, vias and plated board holes. */
  plated: string;
  /** Bare holes: mounting holes and bare pads. */
  bare: string;
  /** The drill table: each size, how many, plated or not. */
  tools: DrillTool[];
  holes: Hole[];
}

export function drillFiles(d: ElectronicsDesign, nl: Netlist = netlist(d)): DrillFiles | null {
  if (!d.board) return null;
  const holes = holesOf(d, boardPads(d, nl));
  const plated = toolsFor(holes, true, 1);
  const bare = toolsFor(holes, false, 1);
  return { plated: excellon(holes, plated, true), bare: excellon(holes, bare, false), tools: [...plated, ...bare], holes };
}
