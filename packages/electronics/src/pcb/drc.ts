import { ratsnest, type BoardPad } from "../board";
import { levelOf, waiveIn, type CheckResult } from "../erc";
import { placeOnBoard, rad } from "../geom";
import { packageOf, type CheckLevel, type ElectronicsDesign, type Id, type P2 } from "../model";
import { byRef, netlist, type Netlist } from "../nets";
import { boardChanges, footprintBox } from "../sync";
import { LINE_GAP, REF_SIZE, boardTextLook, textWidth } from "../fab/font";
import { clearanceBetween, edgeGap, edgeLoops, gap, padSolid, type Copper, type Solid } from "./copper";
import { layerName, layersOf, viaKind, viaLayers } from "./stack";
import { boardState } from "./state";

/**
 * The design rule check (#644): what would stop the board being made, or working, in plain words with what to do
 * about each. It reads the design and changes nothing. Results have the same shape as the schematic's (`erc.ts`), and
 * levels and waivers are kept in the same place, so one card shows both.
 */
export type BoardRuleId =
  | "short"
  | "clearance"
  | "unrouted"
  | "behind"
  | "edge"
  | "off-board"
  | "track-width"
  | "hole-size"
  | "ring"
  | "hole-near"
  | "keepout"
  | "courtyard"
  | "silk-pad"
  | "track-open"
  | "dead-net"
  | "pour-empty"
  | "silk-size"
  | "layer-gone"
  | "via-span"
  | "length-match";

export interface BoardRule {
  id: BoardRuleId;
  label: string;
  level: Exclude<CheckLevel, "ignore">;
}

export const BOARD_RULES: BoardRule[] = [
  { id: "short", label: "Copper on two nets touches", level: "error" },
  { id: "clearance", label: "Copper is too close together", level: "error" },
  { id: "unrouted", label: "A connection is not routed", level: "error" },
  { id: "behind", label: "The board is behind the schematic", level: "error" },
  { id: "edge", label: "Copper is too close to the edge", level: "error" },
  { id: "off-board", label: "A part is off the board", level: "error" },
  { id: "track-width", label: "A track is too narrow", level: "error" },
  { id: "hole-size", label: "A hole is too small", level: "error" },
  { id: "ring", label: "The copper round a hole is too thin", level: "error" },
  { id: "hole-near", label: "Two holes are too close", level: "error" },
  { id: "keepout", label: "Something is in a keep-out", level: "error" },
  { id: "layer-gone", label: "Copper is on a layer the board does not have", level: "error" },
  { id: "courtyard", label: "Two parts overlap", level: "warning" },
  { id: "track-open", label: "A track ends in mid air", level: "warning" },
  { id: "dead-net", label: "Copper is left from a net that is gone", level: "warning" },
  { id: "pour-empty", label: "A pour fills nothing", level: "warning" },
  { id: "via-span", label: "A via does not go right through", level: "warning" },
  { id: "length-match", label: "Nets matched in length have drifted apart", level: "warning" },
  { id: "silk-size", label: "Silkscreen text is too small", level: "warning" },
  { id: "silk-pad", label: "Silkscreen is printed over a pad", level: "warning" },
];

export type BoardResult = CheckResult<BoardRuleId>;

/** A length for a sentence: "0.2 mm", at most three decimals. */
export const mm = (n: number): string => `${Math.round(n * 1000) / 1000} mm`;

const idOf = (c: Copper): string => (c.kind === "pad" ? c.what.replace(" pad ", ".") : c.id);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

interface Hole extends Solid {
  what: string;
  key: string;
  at: P2;
  drill: number;
  part?: Id;
}

function padHole(p: BoardPad): Hole | null {
  const drill = p.pad.drill;
  if (!drill || p.pad.kind === "smd") return null;
  const half = Math.max(0, ((p.pad.slot ?? drill) - drill) / 2);
  const c = Math.cos(rad(p.angle));
  const s = Math.sin(rad(p.angle));
  const pts: P2[] =
    half > 1e-6
      ? [
          [p.at[0] - half * c, p.at[1] - half * s],
          [p.at[0] + half * c, p.at[1] + half * s],
        ]
      : [p.at];
  return { pts, r: drill / 2, what: `${p.ref} pad ${p.pad.number}`, key: `${p.ref}.${p.pad.number}`, at: p.at, drill, part: p.part };
}

/** The outline a placed part takes up, as a four-cornered core. */
function courtyards(d: ElectronicsDesign): { part: Id; ref: string; side: string; solid: Solid; at: P2 }[] {
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  const out = [];
  for (const at of d.board?.placements ?? []) {
    const part = parts.get(at.part);
    const pkg = part && packageOf(d, part);
    if (!part || !pkg) continue;
    const b = footprintBox(pkg.footprint);
    const pts = (
      [
        [b.x1, b.y1],
        [b.x2, b.y1],
        [b.x2, b.y2],
        [b.x1, b.y2],
      ] as P2[]
    ).map((p) => placeOnBoard(p, at));
    out.push({ part: part.id, ref: part.ref, side: at.side, solid: { pts, r: 0 }, at: [at.x, at.y] as P2 });
  }
  return out;
}

/** The box round a piece. */
function boxOf(it: Solid): { x1: number; x2: number; y1: number; y2: number } {
  let [x1, x2, y1, y2] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const p of it.pts) {
    x1 = Math.min(x1, p[0]);
    x2 = Math.max(x2, p[0]);
    y1 = Math.min(y1, p[1]);
    y2 = Math.max(y2, p[1]);
  }
  return { x1: x1 - it.r, x2: x2 + it.r, y1: y1 - it.r, y2: y2 + it.r };
}

/** Pairs of pieces whose boxes, grown by `reach`, overlap. A sweep along x keeps a busy board quick. */
function* near<T extends Solid>(items: T[], reach: number): Generator<[T, T]> {
  const boxed = items
    .map((it) => {
      const xs = it.pts.map((p) => p[0]);
      const ys = it.pts.map((p) => p[1]);
      return { it, x1: Math.min(...xs) - it.r, x2: Math.max(...xs) + it.r, y1: Math.min(...ys) - it.r, y2: Math.max(...ys) + it.r };
    })
    .sort((a, b) => a.x1 - b.x1);
  for (let i = 0; i < boxed.length; i += 1) {
    const a = boxed[i]!;
    for (let j = i + 1; j < boxed.length && boxed[j]!.x1 <= a.x2 + reach; j += 1) {
      const b = boxed[j]!;
      if (b.y1 <= a.y2 + reach && a.y1 <= b.y2 + reach) yield [a.it, b.it];
    }
  }
}

/** Everything the board rules find, errors first. Rules set to ignore are left out; waived results carry their note. */
/** Whether two outlines overlap. Edges that only meet are parts placed side by side, which is fine. */
function overlap(a: Solid, b: Solid): boolean {
  if (gap(a, b) > 0) return false;
  // Pull each in a little and look again.
  const shrink = (s: Solid): Solid => {
    const cx = (s.pts[0]![0] + s.pts[2]![0]) / 2;
    const cy = (s.pts[0]![1] + s.pts[2]![1]) / 2;
    return { pts: s.pts.map((p) => [p[0] + (cx - p[0]) * 0.02, p[1] + (cy - p[1]) * 0.02]), r: 0 };
  };
  return gap(shrink(a), shrink(b)) === 0;
}

/**
 * What is wrong with where the named parts sit, for showing while they are dragged (#639): off the board, in a
 * keep-out, or on top of another part. The board check finds the same things; this looks only at the parts asked for.
 */
export function placeClashes(d: ElectronicsDesign, ids: Iterable<Id>): { parts: Id[]; text: string }[] {
  const board = d.board;
  const moving = new Set(ids);
  if (!board || !moving.size) return [];
  const yards = courtyards(d);
  const loops = edgeLoops(board);
  const out: { parts: Id[]; text: string }[] = [];
  const off = new Set<Id>();
  for (const y of yards) {
    if (!moving.has(y.part)) continue;
    const inside = (p: P2) => edgeGap({ pts: [p], r: 0 }, loops) >= 0;
    if (!inside(y.at) && !y.solid.pts.some(inside)) {
      off.add(y.part);
      out.push({ parts: [y.part], text: `${y.ref} is off the board.` });
    } else if (!y.solid.pts.every(inside)) out.push({ parts: [y.part], text: `${y.ref} hangs over the board's edge.` });
    for (const k of board.keepouts)
      if (k.parts && gap(y.solid, { pts: k.outline, r: 0 }) === 0) out.push({ parts: [y.part], text: `${y.ref} is in a keep-out.` });
  }
  for (const a of yards) {
    if (!moving.has(a.part) || off.has(a.part)) continue;
    for (const b of yards) {
      if (a === b || a.side !== b.side || off.has(b.part) || (moving.has(b.part) && byRef(a.ref, b.ref) > 0) || !overlap(a.solid, b.solid)) continue;
      out.push({ parts: [a.part, b.part], text: `${a.ref} and ${b.ref} overlap.` });
    }
  }
  return out;
}

export function checkBoard(d: ElectronicsDesign, nl: Netlist = netlist(d)): BoardResult[] {
  const board = d.board;
  if (!board) return [];
  const out: BoardResult[] = [];
  const level = new Map(BOARD_RULES.map((r) => [r.id, levelOf(d, r)]));
  const seen = new Set<string>();
  const add = (rule: BoardRuleId, key: string, text: string, fix: string, at?: P2, parts: Id[] = []) => {
    const l = level.get(rule);
    const k = `${rule}:${key}`;
    if (!l || l === "ignore" || seen.has(k)) return;
    seen.add(k);
    const waived = d.checks?.waived?.[k];
    out.push({ rule, level: l, key: k, text, fix, parts, ...(at ? { at, board: true as const } : {}), ...(waived !== undefined ? { waived } : {}) });
  };
  const on = (l: BoardRuleId) => (level.get(l) ?? "ignore") !== "ignore";

  const rules = board.rules;
  const layers = layersOf(board);
  const { pads, copper, groups, fills } = boardState(d, nl);
  const loops = edgeLoops(board);
  const partOfPad = (c: Copper): Id[] => (c.kind === "pad" ? [c.id] : []);

  const changes = boardChanges(d, nl).filter((c) => c.kind !== "dead-net");
  if (changes.length)
    add(
      "behind",
      "board",
      `The board is behind the schematic by ${changes.length} ${changes.length === 1 ? "change" : "changes"}.`,
      "Use Update board to bring the changes across.",
    );

  // Copper against copper: touching is a short, too close a clearance problem. A part's own pads are its footprint's business.
  if (on("short") || on("clearance")) {
    const live = copper.filter((c) => c.layers.length);
    const reach = Math.max(rules.clearance, ...board.classes.map((k) => k.clearance));
    const worst = new Map<string, { a: Copper; b: Copper; g: number; need: number }>();
    for (const [a, b] of near(live, reach)) {
      if ((a.net && a.net === b.net) || !a.layers.some((l) => b.layers.includes(l))) continue;
      if (a.kind === "pad" && b.kind === "pad" && a.id === b.id) continue;
      if (a.kind !== "pad" && a.id === b.id) continue;
      const need = clearanceBetween(board, a.net, b.net);
      const g = gap(a, b);
      // Half a micron of grace: a gap that reads as the rule's own number passes it.
      if (g >= need - 5e-4) continue;
      const k = [idOf(a), idOf(b)].sort(byRef).join("|");
      const was = worst.get(k);
      if (!was || g < was.g) worst.set(k, { a, b, g, need });
    }
    for (const [k, w] of worst) {
      const [a, b] = byRef(idOf(w.a), idOf(w.b)) <= 0 ? [w.a, w.b] : [w.b, w.a];
      const at: P2 = a.kind === "pad" ? b.at : a.at;
      const parts = [...partOfPad(a), ...partOfPad(b)];
      if (w.g === 0)
        add(
          "short",
          k,
          `${cap(a.what)} touches ${b.what}${a.net && b.net ? `, joining ${a.net} and ${b.net}` : ""}.`,
          "Move one of them, or route the track another way.",
          at,
          parts,
        );
      else
        add(
          "clearance",
          k,
          `${cap(a.what)} and ${b.what} are ${mm(w.g)} apart. The rules ask for ${mm(w.need)}.`,
          "Move them apart, or use a narrower track.",
          at,
          parts,
        );
    }
  }

  // Connections still to route, a net at a time.
  if (on("unrouted")) {
    const airs = ratsnest(pads, (_, i) => groups[i]!);
    const byNet = new Map<string, typeof airs>();
    for (const a of airs) byNet.set(a.net, [...(byNet.get(a.net) ?? []), a]);
    for (const [net, list] of [...byNet].sort((a, b) => byRef(a[0], b[0])))
      add(
        "unrouted",
        net,
        `${net} still has ${list.length} ${list.length === 1 ? "connection" : "connections"} to route.`,
        "Route a track along each thin line, or join them with a via.",
        [(list[0]!.a[0] + list[0]!.b[0]) / 2, (list[0]!.a[1] + list[0]!.b[1]) / 2],
      );
  }

  // The edge. A part parked beside the board is one result, not one per pad.
  const off = new Set<Id>();
  for (const y of courtyards(d)) {
    if (edgeGap({ pts: [y.at], r: 0 }, loops) >= 0 || y.solid.pts.some((p) => edgeGap({ pts: [p], r: 0 }, loops) >= 0)) continue;
    off.add(y.part);
    add("off-board", y.ref, `${y.ref} is off the board.`, "Drag it onto the board.", y.at, [y.part]);
  }
  for (const c of copper) {
    if (!c.layers.length || (c.kind === "pad" && off.has(c.id))) continue;
    const e = edgeGap(c, loops);
    if (e >= rules.copperToEdge - 1e-6) continue;
    add(
      "edge",
      idOf(c),
      e <= 0 ? `${cap(c.what)} is over the board's edge.` : `${cap(c.what)} is ${mm(e)} from the board's edge. The rules ask for ${mm(rules.copperToEdge)}.`,
      "Move it in from the edge.",
      c.at,
      partOfPad(c),
    );
  }

  for (const t of board.tracks)
    if (t.width < rules.minTrackWidth - 1e-6)
      add(
        "track-width",
        t.id,
        `A track on ${t.net || "no net"} is ${mm(t.width)} wide. The narrowest the rules allow is ${mm(rules.minTrackWidth)}.`,
        "Pick the track and make it wider.",
        t.pts[0],
      );
  // A hatched pour's lines are tracks to the board house (#747).
  for (const p of board.pours)
    if (p.hatch && p.hatch.width < rules.minTrackWidth - 1e-6)
      add(
        "track-width",
        p.id,
        `The hatched pour on ${p.net || "no net"} has lines ${mm(p.hatch.width)} wide. The narrowest the rules allow is ${mm(rules.minTrackWidth)}.`,
        "Pick the pour and make its lines wider.",
        p.outline[0],
      );

  // Holes: size, the copper round them, and how close they sit.
  const holes: Hole[] = [];
  for (const p of pads) {
    if (off.has(p.part)) continue;
    const h = padHole(p);
    if (!h) continue;
    holes.push(h);
    if (p.pad.kind === "thru") {
      // Copper off the hole's middle (#744) leaves the ring thinner on one side by as much.
      const ring = (Math.min(p.pad.w, p.pad.h) - h.drill) / 2 - Math.hypot(...(p.pad.offset ?? [0, 0]));
      if (ring < rules.minRing - 1e-6)
        add(
          "ring",
          h.key,
          `${h.what} has ${mm(Math.max(0, ring))} of copper round its hole. The rules ask for ${mm(rules.minRing)}.`,
          "Use a footprint with larger pads, or relax the rule if your board house allows it.",
          h.at,
          [p.part],
        );
    }
  }
  for (const v of board.vias) {
    holes.push({ pts: [[v.x, v.y]], r: v.drill / 2, what: `a via on ${v.net || "no net"}`, key: v.id, at: [v.x, v.y], drill: v.drill });
    const ring = (v.diameter - v.drill) / 2;
    const need = rules.minViaRing ?? rules.minRing;
    if (ring < need - 1e-6)
      add(
        "ring",
        v.id,
        `A via on ${v.net || "no net"} has ${mm(Math.max(0, ring))} of copper round its hole. The rules ask for ${mm(need)}.`,
        "Make the via larger or its hole smaller.",
        [v.x, v.y],
      );
  }
  for (const h of board.holes) {
    holes.push({ pts: [[h.x, h.y]], r: h.drill / 2, what: "a mounting hole", key: h.id, at: [h.x, h.y], drill: h.drill });
    if (h.pad && (h.pad - h.drill) / 2 < rules.minRing - 1e-6)
      add(
        "ring",
        h.id,
        `A mounting hole has ${mm(Math.max(0, (h.pad - h.drill) / 2))} of copper round it. The rules ask for ${mm(rules.minRing)}.`,
        "Make its pad larger, or take the pad away.",
        [h.x, h.y],
      );
    const e = edgeGap({ pts: [[h.x, h.y]], r: h.drill / 2 }, loops);
    if (e < 0) add("off-board", h.id, "A mounting hole is off the board.", "Drag it onto the board, or delete it.", [h.x, h.y]);
  }
  for (const h of holes)
    if (h.drill < rules.minDrill - 1e-6)
      add(
        "hole-size",
        h.key,
        `${cap(h.what)} has a ${mm(h.drill)} hole. The smallest the rules allow is ${mm(rules.minDrill)}.`,
        "Use a larger hole.",
        h.at,
        h.part ? [h.part] : [],
      );
  for (const [a, b] of near(holes, rules.holeToHole)) {
    const g = gap(a, b);
    if (g >= rules.holeToHole - 1e-6 || (a.part && a.part === b.part)) continue;
    add(
      "hole-near",
      [a.key, b.key].sort(byRef).join("|"),
      `The holes of ${a.what} and ${b.what} are ${mm(g)} apart. The rules ask for ${mm(rules.holeToHole)}.`,
      "Move them apart, so the board does not break between them.",
      a.at,
      [a.part, b.part].filter((x): x is Id => !!x),
    );
  }

  // Keep-outs and parts on top of each other.
  const yards = courtyards(d).filter((y) => !off.has(y.part));
  for (const k of board.keepouts) {
    const area: Solid = { pts: k.outline, r: 0 };
    if (k.tracks)
      for (const c of copper)
        if (c.kind !== "pad" && gap(c, area) === 0)
          add("keepout", `${k.id}|${c.id}`, `${cap(c.what)} is in a keep-out.`, "Route round it, or change what the keep-out stops.", c.at);
    if (k.parts)
      for (const y of yards)
        if (gap(y.solid, area) === 0)
          add("keepout", `${k.id}|${y.ref}`, `${y.ref} is in a keep-out.`, "Move it out, or change what the keep-out stops.", y.at, [y.part]);
  }
  for (const [a, b] of near(
    yards.map((y) => ({ ...y.solid, y })),
    0,
  )) {
    if (a.y.side !== b.y.side || !overlap(a, b)) continue;
    const [x, y] = byRef(a.y.ref, b.y.ref) <= 0 ? [a.y, b.y] : [b.y, a.y];
    add("courtyard", `${x.ref}|${y.ref}`, `${x.ref} and ${y.ref} overlap.`, "Move them apart, so both can be fitted.", y.at, [x.part, y.part]);
  }

  // Track ends that reach nothing.
  if (on("track-open"))
    for (const t of board.tracks) {
      if (!layers.includes(t.layer)) continue;
      const layer = t.layer;
      for (const end of [t.pts[0]!, t.pts[t.pts.length - 1]!]) {
        const tip: Solid = { pts: [end], r: 0 };
        if (copper.some((c) => c.id !== t.id && c.net === t.net && c.layers.includes(layer) && gap(tip, c) === 0)) continue;
        add(
          "track-open",
          `${t.id}@${end.join(",")}`,
          `A track on ${t.net || "no net"} ends in mid air.`,
          "Carry it on to a pad, a via or another track, or delete it.",
          end,
        );
      }
    }

  // Copper whose net the schematic no longer has.
  // Inner layers (#648): copper on a layer the board does not have, and vias a board house charges more for.
  for (const t of board.tracks)
    if (!layers.includes(t.layer))
      add(
        "layer-gone",
        t.id,
        `A track on ${t.net || "no net"} is on ${layerName(t.layer)}, a layer this board does not have.`,
        "Give the board more layers in Board setup, or delete the track.",
        t.pts[0],
      );
  for (const p of board.pours)
    if (!layers.includes(p.layer))
      add(
        "layer-gone",
        p.id,
        `The pour on ${p.net || "no net"} is on ${layerName(p.layer)}, a layer this board does not have.`,
        "Give the board more layers in Board setup, or delete the pour.",
        p.outline[0],
      );
  for (const v of board.vias) {
    const kind = viaKind(board, v);
    if (kind === "through") continue;
    const on = viaLayers(board, v);
    add(
      "via-span",
      v.id,
      `A via on ${v.net || "no net"} is ${kind}: it joins ${layerName(on[0]!)} to ${layerName(on[on.length - 1]!)} only.`,
      "Board houses charge more for these, and some do not make them. Make it go right through if you can.",
      [v.x, v.y],
    );
  }

  // Matched lengths (#745): the group's longest and shortest nets more than its tolerance apart.
  for (const g of board.matched ?? []) {
    const len = (net: string) =>
      board.tracks.reduce(
        (n, t) => (t.net === net ? n + t.pts.slice(1).reduce((m, p, i) => m + Math.hypot(p[0] - t.pts[i]![0], p[1] - t.pts[i]![1]), 0) : n),
        0,
      );
    const lengths = g.nets.map((net) => ({ net, l: len(net) })).sort((a, b) => b.l - a.l);
    const [long, short] = [lengths[0], lengths.at(-1)];
    if (!long || !short || long.l - short.l <= g.tolerance + 1e-6) continue;
    const at = board.tracks.find((t) => t.net === short.net)?.pts[0];
    add(
      "length-match",
      g.id,
      `${short.net} is ${mm(long.l - short.l)} shorter than ${long.net}. They are matched to within ${mm(g.tolerance)}.`,
      "Pick a track on one of them and press Match lengths again.",
      at,
    );
  }

  const nets = new Set(nl.nets.map((n) => n.name));
  const dead = new Map<string, P2>();
  for (const t of board.tracks) if (t.net && !nets.has(t.net) && !dead.has(t.net)) dead.set(t.net, t.pts[0]!);
  for (const v of board.vias) if (v.net && !nets.has(v.net) && !dead.has(v.net)) dead.set(v.net, [v.x, v.y]);
  for (const [net, at] of dead)
    add("dead-net", net, `Copper is left on ${net}, a net the schematic no longer has.`, "Delete the copper, or put the net back.", at);

  // A pour that joins none of its net's copper is dropped whole, as one big island.
  for (const f of fills)
    if (f.area === 0)
      add(
        "pour-empty",
        f.pour.id,
        `The pour on ${f.pour.net || "no net"} fills nothing.`,
        f.pour.net ? "It needs a pad, a via or a track of its net inside it, and room round the other copper." : "Give it a net.",
        f.pour.outline[0],
      );

  for (const t of board.texts)
    if (t.layer.startsWith("silk") && t.size < rules.minSilkHeight - 1e-6)
      add(
        "silk-size",
        t.id,
        `The text "${t.text}" is ${mm(t.size)} tall. The smallest that prints well is ${mm(rules.minSilkHeight)}.`,
        "Make the text larger.",
        [t.x, t.y],
      );

  // Ink over a pad's opening is cut away when the files are made (#642), so say which words lose a piece.
  if (on("silk-pad")) {
    const open = pads.map((p) => {
      const s = padSolid(p);
      return { p, solid: { pts: s.pts, r: s.r + (p.pad.maskMargin ?? rules.maskMargin) } };
    });
    // A quick box round each opening first: measuring every word against every pad is slow on a big board.
    const boxes = open.map((o) => boxOf(o.solid));
    const hit = (box: P2[], side: "top" | "bottom") => {
      const b = boxOf({ pts: box, r: 0 });
      return open.find(
        (o, i) =>
          (o.p.pad.kind !== "smd" || o.p.side === side) &&
          boxes[i]!.x1 <= b.x2 &&
          b.x1 <= boxes[i]!.x2 &&
          boxes[i]!.y1 <= b.y2 &&
          b.y1 <= boxes[i]!.y2 &&
          gap({ pts: box, r: 0 }, o.solid) === 0,
      )?.p;
    };
    const parts = new Map(d.parts.map((p) => [p.id, p]));
    for (const at of board.placements) {
      const part = parts.get(at.part);
      const pkg = part && packageOf(d, part);
      if (!part || !pkg || at.refHidden) continue;
      const size = Math.max(REF_SIZE, rules.minSilkHeight);
      const c = placeOnBoard(at.refAt ?? pkg.footprint.refAt ?? [0, 0], at);
      const w = textWidth(part.ref, size) / 2;
      const pad = hit(
        [
          [c[0] - w, c[1] - size / 2],
          [c[0] + w, c[1] - size / 2],
          [c[0] + w, c[1] + size / 2],
          [c[0] - w, c[1] + size / 2],
        ],
        at.side,
      );
      if (pad)
        add(
          "silk-pad",
          part.ref,
          `${part.ref}'s name is printed over ${pad.ref} pad ${pad.pad.number}. The ink is cut away there.`,
          "Move the part, or hide its name on the silkscreen.",
          c,
          [part.id],
        );
    }
    for (const t of board.texts) {
      if (!t.layer.startsWith("silk")) continue;
      const side = t.layer === "silk-bottom" ? "bottom" : "top";
      const cap = t.size * 0.72;
      const a = rad(t.angle ?? 0);
      const look = boardTextLook(t);
      const flip = look.mirror ? -1 : 1;
      const corner = (x: number, y: number): P2 => [t.x + flip * x * Math.cos(a) - y * Math.sin(a), t.y + flip * x * Math.sin(a) + y * Math.cos(a)];
      const w = textWidth(t.text, cap) * (look.stretch ?? 1);
      // Further lines go below the first, as they are drawn and printed (#730).
      const low = -(t.text.split("\n").length - 1) * cap * LINE_GAP;
      const pad = hit([corner(0, low), corner(w, low), corner(w, cap), corner(0, cap)], side);
      if (pad)
        add(
          "silk-pad",
          t.id,
          `The text "${t.text}" is printed over ${pad.ref} pad ${pad.pad.number}. The ink is cut away there.`,
          "Move the text clear of the pad.",
          [t.x, t.y],
        );
    }
  }

  if (on("silk-pad"))
    for (const pic of board.pictures ?? []) {
      const side = pic.layer === "silk-bottom" ? "bottom" : "top";
      const top = pic.y + (pic.w / pic.cols) * pic.rows;
      const box: Solid = {
        pts: [
          [pic.x, pic.y],
          [pic.x + pic.w, pic.y],
          [pic.x + pic.w, top],
          [pic.x, top],
        ],
        r: 0,
      };
      const pad = pads.find((p) => (p.pad.kind !== "smd" || p.side === side) && gap(box, padSolid(p)) === 0);
      if (pad)
        add(
          "silk-pad",
          pic.id,
          `A picture is printed over ${pad.ref} pad ${pad.pad.number}. The ink is cut away there.`,
          "Move the picture clear of the pad.",
          [pic.x, pic.y],
        );
    }

  const rank = (r: BoardResult) => (r.waived !== undefined ? 2 : r.level === "error" ? 0 : 1);
  const order = (r: BoardResult) => BOARD_RULES.findIndex((x) => x.id === r.rule);
  return out.sort((a, b) => rank(a) - rank(b) || order(a) - order(b) || byRef(a.key, b.key));
}

/** Waives a board result with a note, or (no note) takes the waiver back. */
export function waiveBoard(d: ElectronicsDesign, key: string, note?: string): ElectronicsDesign {
  return waiveIn(
    d,
    key,
    note,
    BOARD_RULES,
    checkBoard({ ...d, checks: { ...d.checks, waived: {} } }).map((r) => r.key),
  );
}
