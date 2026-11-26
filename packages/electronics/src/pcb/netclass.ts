import { eid, type Board, type CopperLayer, type ElectronicsDesign, type Id, type NetClass, type NetLook } from "../model";
import { netRules } from "./copper";
import { trackLength } from "./route";

/**
 * A net's settings from the inspector: which class it is in, its tracks' width, and what is on it. Board → Setup
 * keeps the full list of classes; these change one net, or one class, in place.
 */

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** The class a net is in, if any. A net is in one class at a time. */
export const classOf = (board: Pick<Board, "classes">, net: string): NetClass | undefined => board.classes.find((c) => c.nets.includes(net));

/**
 * Copper on `nets` drawn at the old rules takes the new ones: tracks at the old width, vias at the old size. Copper
 * someone sized by hand keeps its size.
 */
function follow(board: Board, nets: Set<string>, was: (net: string) => ReturnType<typeof netRules>, now: (net: string) => ReturnType<typeof netRules>): Board {
  return {
    ...board,
    tracks: board.tracks.map((t) => {
      if (!nets.has(t.net)) return t;
      const a = was(t.net);
      const b = now(t.net);
      return near(t.width, a.trackWidth) && !near(a.trackWidth, b.trackWidth) ? { ...t, width: b.trackWidth } : t;
    }),
    vias: board.vias.map((v) => {
      if (!nets.has(v.net)) return v;
      const a = was(v.net);
      const b = now(v.net);
      return near(v.diameter, a.viaDiameter) && near(v.drill, a.viaDrill) && !(near(a.viaDiameter, b.viaDiameter) && near(a.viaDrill, b.viaDrill))
        ? { ...v, diameter: b.viaDiameter, drill: b.viaDrill }
        : v;
    }),
  };
}

/** Puts a net in a class, or takes it out of every class with `null`. Its copper at the old rules follows. */
export function setNetClass(d: ElectronicsDesign, net: string, classId: Id | null): ElectronicsDesign {
  const board = d.board;
  if (!board || !net) return d;
  if (classId !== null && !board.classes.some((c) => c.id === classId)) return d;
  if ((classOf(board, net)?.id ?? null) === classId) return d;
  const classes = board.classes.map((c) =>
    c.id === classId ? { ...c, nets: [...c.nets.filter((n) => n !== net), net] } : c.nets.includes(net) ? { ...c, nets: c.nets.filter((n) => n !== net) } : c,
  );
  const next = { ...board, classes };
  return {
    ...d,
    board: follow(
      next,
      new Set([net]),
      (n) => netRules(board, n),
      (n) => netRules(next, n),
    ),
  };
}

/** A name for a new class: Power for the first, then Class 2, Class 3… that no class has yet. */
export function newClassName(board: Pick<Board, "classes">): string {
  const taken = new Set(board.classes.map((c) => c.name.toLowerCase()));
  if (!taken.has("power")) return "Power";
  for (let i = board.classes.length + 1; ; i += 1) if (!taken.has(`class ${i}`)) return `Class ${i}`;
}

/** Adds a class (wider tracks than the board's own, for power) with `net` in it. */
export function addNetClass(d: ElectronicsDesign, net?: string, name?: string): { design: ElectronicsDesign; id: Id } {
  const id = eid("nc");
  const board = d.board;
  if (!board) return { design: d, id };
  const k: NetClass = {
    id,
    name: name ?? newClassName(board),
    nets: [],
    trackWidth: Math.max(0.5, board.rules.trackWidth * 2),
    clearance: board.rules.clearance,
  };
  const added = { ...d, board: { ...board, classes: [...board.classes, k] } };
  return { design: net ? setNetClass(added, net, id) : added, id };
}

/** Changes a class's name or numbers. Copper on its nets at the old numbers follows. */
export function changeNetClass(
  d: ElectronicsDesign,
  id: Id,
  change: Partial<Pick<NetClass, "name" | "trackWidth" | "clearance" | "viaDiameter" | "viaDrill">>,
): ElectronicsDesign {
  const board = d.board;
  const k = board?.classes.find((c) => c.id === id);
  if (!board || !k) return d;
  for (const v of [change.trackWidth, change.clearance, change.viaDiameter, change.viaDrill]) if (v !== undefined && !(v > 0)) return d;
  if (change.name !== undefined && !change.name.trim()) return d;
  const next = { ...board, classes: board.classes.map((c) => (c.id === id ? { ...c, ...change } : c)) };
  return {
    ...d,
    board: follow(
      next,
      new Set(k.nets),
      (n) => netRules(board, n),
      (n) => netRules(next, n),
    ),
  };
}

/** Sets every track on a net to one width. */
export function setNetWidth(d: ElectronicsDesign, net: string, width: number): ElectronicsDesign {
  const board = d.board;
  if (!board || !net || !(width > 0) || !board.tracks.some((t) => t.net === net && !near(t.width, width))) return d;
  return { ...d, board: { ...board, tracks: board.tracks.map((t) => (t.net === net ? { ...t, width } : t)) } };
}

export interface NetFacts {
  tracks: number;
  vias: number;
  /** All its track, end to end, mm. */
  length: number;
  /** Layers its tracks run on, top first. */
  layers: CopperLayer[];
  /** The widths its tracks are drawn at, thinnest first. */
  widths: number[];
}

/** What copper a net has on the board. */
export function netFacts(board: Pick<Board, "tracks" | "vias">, net: string, order: CopperLayer[]): NetFacts {
  const tracks = board.tracks.filter((t) => t.net === net);
  const on = new Set(tracks.map((t) => t.layer));
  return {
    tracks: tracks.length,
    vias: board.vias.filter((v) => v.net === net).length,
    length: tracks.reduce((n, t) => n + trackLength(t.pts), 0),
    layers: order.filter((l) => on.has(l)),
    widths: [...new Set(tracks.map((t) => Math.round(t.width * 1000) / 1000))].sort((a, b) => a - b),
  };
}

/** The colours a net can be given (#740), in the order the inspector lists them. */
export const NET_COLOURS = ["green", "orange", "teal", "pink", "yellow", "purple", "blue"] as const;

/**
 * Changes how a net looks on the board (#740): its colour, and whether its unrouted lines are drawn. `undefined` takes
 * a setting off; a net with nothing set is left out.
 */
export function setNetLook(d: ElectronicsDesign, net: string, change: Partial<Record<keyof NetLook, NetLook[keyof NetLook] | undefined>>): ElectronicsDesign {
  const board = d.board;
  if (!board || !net) return d;
  const look: Record<string, unknown> = { ...board.netLooks?.[net], ...change };
  for (const k of Object.keys(look)) if (look[k] === undefined) delete look[k];
  const rest = { ...board.netLooks };
  delete rest[net];
  const looks = Object.keys(look).length ? { ...rest, [net]: look as NetLook } : rest;
  const next: Board = { ...board, netLooks: looks };
  if (!Object.keys(looks).length) delete next.netLooks;
  return { ...d, board: next };
}
