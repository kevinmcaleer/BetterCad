import { boardPads, type BoardPad } from "../board";
import { rad } from "../geom";
import type { ElectronicsDesign, P2 } from "../model";
import { netlist, type Netlist } from "../nets";
import { layersOf, viaLayers } from "../pcb/stack";

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
  /** For a blind or buried via (#648): the first and last layer it is drilled through, counted from 1 at the top. */
  span?: [number, number];
}

export interface DrillTool {
  tool: number;
  d: number;
  plated: boolean;
  holes: number;
  slots: number;
  /** For blind or buried vias: the layers the tool drills, counted from 1 at the top. */
  span?: [number, number];
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
  const all = layersOf(board);
  for (const v of board.vias) {
    const on = viaLayers(board, v);
    const part = on.length < all.length;
    out.push({
      d: v.drill,
      at: [v.x, v.y],
      plated: true,
      what: "via",
      ...(part ? { span: [all.indexOf(on[0]!) + 1, all.indexOf(on[on.length - 1]!) + 1] as [number, number] } : {}),
    });
  }
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

function excellon(holes: Hole[], tools: DrillTool[], plated: boolean, layers = 2, span?: [number, number]): string {
  const fn = span
    ? `Plated,${span[0]},${span[1]},${span[0] === 1 || span[1] === layers ? "Blind" : "Buried"}`
    : plated
      ? `Plated,1,${layers},PTH`
      : `NonPlated,1,${layers},NPTH`;
  const lines = [
    "M48",
    "; DRILL file {BetterCad}",
    "; FORMAT={-:-/ absolute / metric / decimal}",
    `; #@! TF.FileFunction,${fn}`,
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
  /** A file for each span of blind or buried vias (#648): they are drilled apart from the holes that go through. */
  spans: { from: number; to: number; text: string; tools: DrillTool[] }[];
}

export function drillFiles(d: ElectronicsDesign, nl: Netlist = netlist(d)): DrillFiles | null {
  if (!d.board) return null;
  return excellonFor(holesOf(d, boardPads(d, nl)), layersOf(d.board).length);
}

/** The drill files for a set of holes: through holes plated and bare, and blind or buried vias by their span. */
export function excellonFor(holes: Hole[], layers: number): DrillFiles {
  const through = holes.filter((h) => !h.span);
  const plated = toolsFor(through, true, 1);
  const bare = toolsFor(through, false, 1);
  const keys = [...new Set(holes.flatMap((h) => (h.span ? [h.span.join("-")] : [])))].sort();
  const spans = keys.map((k) => {
    const mine = holes.filter((h) => h.span?.join("-") === k);
    const [from, to] = mine[0]!.span!;
    const tools = toolsFor(mine, true, 1).map((t): DrillTool => ({ ...t, span: [from, to] }));
    return { from, to, text: excellon(mine, tools, true, layers, [from, to]), tools };
  });
  return {
    plated: excellon(through, plated, true, layers),
    bare: excellon(through, bare, false, layers),
    tools: [...plated, ...bare, ...spans.flatMap((s) => s.tools)],
    holes,
    spans,
  };
}
