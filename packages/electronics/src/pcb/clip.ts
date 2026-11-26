/**
 * Copy, paste and duplicate on the board (#741). A clip holds copper and drawings off the board, and the parts that
 * were picked with them, by footprint and with the net of each pad. Pasted on its own, everything lands where it is
 * put with fresh ids; copper takes the net of what it lands on, or is on no net. Pasted onto the same number of
 * matching parts, which are picked, the clip lays them out as the copied parts were and routes them the same way,
 * with each net swapped for the one the matching pad is on: a channel repeated.
 */
import { boardPads, type BoardPad } from "../board";
import { key, q } from "../geom";
import {
  eid,
  packageOf,
  type Board,
  type BoardHole,
  type BoardMark,
  type BoardPicture,
  type ElectronicsDesign,
  type Id,
  type Keepout,
  type P2,
  type Pour,
  type Track,
  type Via,
} from "../model";
import { byRef } from "../nets";
import { copperOf, gap, type Copper, type Layer } from "./copper";
import { layersOf, viaLayers } from "./stack";

export interface ClipPart {
  ref: string;
  footprint: string;
  x: number;
  y: number;
  rot: number;
  side: "top" | "bottom";
  /** Each pad's net, by pad number. */
  pads: Record<string, string>;
}

export interface BoardClip {
  kind: "board";
  tracks: Track[];
  vias: Via[];
  pours: Pour[];
  keepouts: Keepout[];
  texts: Board["texts"];
  pictures: BoardPicture[];
  holes: BoardHole[];
  marks: BoardMark[];
  parts: ClipPart[];
}

const footprintOf = (d: ElectronicsDesign, part: Id): string => {
  const p = d.parts.find((x) => x.id === part);
  return (p && packageOf(d, p)?.footprint.name) ?? "";
};

/** How far round a part's pads a track may reach and still go with the part when the part is copied, mm. */
const REACH = 2.5;

/**
 * What a selection copies. A picked part takes with it the tracks and vias of its pads' nets that lie wholly round
 * the picked parts, so copying a channel's parts copies its routing too.
 */
export function copyBoard(d: ElectronicsDesign, ids: Id[]): BoardClip | null {
  const b = d.board;
  if (!b || !ids.length) return null;
  const set = new Set(ids);
  const pads = boardPads(d);
  const placed = b.placements.filter((p) => set.has(p.part));
  const parts: ClipPart[] = placed.map((p) => ({
    ref: p.ref ?? d.parts.find((x) => x.id === p.part)?.ref ?? "",
    footprint: footprintOf(d, p.part),
    x: p.x,
    y: p.y,
    rot: p.rot,
    side: p.side,
    pads: Object.fromEntries(pads.filter((x) => x.part === p.part).map((x) => [x.pad.number, x.net])),
  }));
  // The routing of picked parts: on their nets and inside the box round their pads.
  const mine = pads.filter((x) => set.has(x.part));
  const nets = new Set(mine.map((x) => x.net).filter(Boolean));
  const xs = mine.map((x) => x.at[0]);
  const ys = mine.map((x) => x.at[1]);
  const inside = (p: P2) =>
    mine.length > 0 && p[0] >= Math.min(...xs) - REACH && p[0] <= Math.max(...xs) + REACH && p[1] >= Math.min(...ys) - REACH && p[1] <= Math.max(...ys) + REACH;
  const goes = (net: string, pts: P2[]) => nets.has(net) && pts.every(inside);
  const clip: BoardClip = {
    kind: "board",
    tracks: b.tracks.filter((t) => set.has(t.id) || goes(t.net, t.pts)),
    vias: b.vias.filter((v) => set.has(v.id) || goes(v.net, [[v.x, v.y]])),
    pours: b.pours.filter((x) => set.has(x.id)),
    keepouts: b.keepouts.filter((x) => set.has(x.id)),
    texts: b.texts.filter((x) => set.has(x.id)),
    pictures: (b.pictures ?? []).filter((x) => set.has(x.id)),
    holes: b.holes.filter((x) => set.has(x.id)),
    marks: (b.marks ?? []).filter((x) => set.has(x.id)),
    parts,
  };
  return clipEmpty(clip) ? null : clip;
}

const clipEmpty = (c: BoardClip) =>
  !c.tracks.length &&
  !c.vias.length &&
  !c.pours.length &&
  !c.keepouts.length &&
  !c.texts.length &&
  !c.pictures.length &&
  !c.holes.length &&
  !c.marks.length &&
  !c.parts.length;

/** The clip's bottom left corner: what lands under the pointer. */
export function boardClipOrigin(c: BoardClip): P2 {
  const pts: P2[] = [
    ...c.tracks.flatMap((t) => t.pts),
    ...[...c.vias, ...c.holes, ...c.marks, ...c.texts, ...c.pictures, ...c.parts].map((o): P2 => [o.x, o.y]),
    ...c.pours.flatMap((o) => o.outline),
    ...c.keepouts.flatMap((o) => o.outline),
  ];
  return pts.length ? [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))] : [0, 0];
}

export interface Pasted {
  design: ElectronicsDesign;
  /** What was put down, to pick. */
  ids: Id[];
  /** Pieces of copper that landed on nothing, and are on no net. */
  offNet: number;
  /** Parts moved into the copied layout. */
  laid: number;
  /** Why nothing could be pasted, or what was left out. */
  why?: string;
}

type Move = (p: P2) => P2;

/** Pairs the clip's parts with the picked parts on the board: the same footprints, in reference order. */
function pairParts(d: ElectronicsDesign, clip: BoardClip, picked: Id[]): { pairs: [ClipPart, Board["placements"][number]][]; why?: string } | null {
  const b = d.board!;
  const targets = b.placements.filter((p) => picked.includes(p.part));
  if (!clip.parts.length || !targets.length) return null;
  if (targets.length !== clip.parts.length)
    return { pairs: [], why: `The copy has ${clip.parts.length} ${clip.parts.length === 1 ? "part" : "parts"}. Pick as many matching parts to lay out.` };
  const refOf = (p: Board["placements"][number]) => p.ref ?? d.parts.find((x) => x.id === p.part)?.ref ?? "";
  const group = <T>(list: T[], fp: (x: T) => string, ref: (x: T) => string) => {
    const m = new Map<string, T[]>();
    for (const x of [...list].sort((a, c) => byRef(ref(a), ref(c)))) m.set(fp(x), [...(m.get(fp(x)) ?? []), x]);
    return m;
  };
  const mine = group(
    clip.parts,
    (p) => p.footprint,
    (p) => p.ref,
  );
  const theirs = group(targets, (p) => footprintOf(d, p.part), refOf);
  const pairs: [ClipPart, Board["placements"][number]][] = [];
  for (const [fp, list] of mine) {
    const other = theirs.get(fp) ?? [];
    if (other.length !== list.length)
      return { pairs: [], why: `The picked parts are not the copied ones: the copy has ${list.length} × ${fp || "no footprint"}.` };
    list.forEach((p, i) => pairs.push([p, other[i]!]));
  }
  pairs.sort((a, c) => byRef(a[0].ref, c[0].ref));
  return { pairs };
}

/**
 * Pastes a clip. With `picked` parts that match the clip's, the parts are laid out as copied and the routing follows
 * them (the first part by reference stays where it is). Otherwise everything lands with its bottom left corner at `at`.
 */
export function pasteBoard(d: ElectronicsDesign, clip: BoardClip, at: P2, picked: Id[] = []): Pasted {
  const b = d.board;
  if (!b) return { design: d, ids: [], offNet: 0, laid: 0, why: "There is no board to paste on." };
  const paired = pairParts(d, clip, picked);
  if (paired?.why) return { design: d, ids: [], offNet: 0, laid: 0, why: paired.why };
  const pads = boardPads(d);

  let move: Move;
  let turn = 0;
  let netOf: ((net: string) => string | undefined) | null = null;
  let placements = b.placements;
  let laid = 0;
  if (paired?.pairs.length) {
    const [from, to] = paired.pairs[0]!;
    if (paired.pairs.some(([cp, p]) => cp.side !== p.side))
      return { design: d, ids: [], offNet: 0, laid: 0, why: "The picked parts are on other sides from the copied ones. Flip them to match first." };
    turn = (((to.rot - from.rot) % 360) + 360) % 360;
    const c = Math.cos((turn * Math.PI) / 180);
    const s = Math.sin((turn * Math.PI) / 180);
    move = ([x, y]) => {
      const dx = x - from.x;
      const dy = y - from.y;
      return [q(to.x + dx * c - dy * s), q(to.y + dx * s + dy * c)];
    };
    // Each copied net becomes the net of the matching pad on the picked parts.
    const map = new Map<string, string>();
    for (const [cp, p] of paired.pairs)
      for (const [pad, net] of Object.entries(cp.pads)) {
        const now = pads.find((x) => x.part === p.part && x.pad.number === pad)?.net;
        if (net && now && !map.has(net)) map.set(net, now);
      }
    netOf = (net) => map.get(net);
    const where = new Map(paired.pairs.map(([cp, p]) => [p.part, cp]));
    placements = b.placements.map((p) => {
      const cp = where.get(p.part);
      if (!cp || p.locked) return p;
      const [x, y] = move([cp.x, cp.y]);
      laid += 1;
      return { ...p, x, y, rot: (((cp.rot + turn) % 360) + 360) % 360 };
    });
  } else {
    const o = boardClipOrigin(clip);
    const dx = at[0] - o[0];
    const dy = at[1] - o[1];
    move = ([x, y]) => [q(x + dx), q(y + dy)];
  }

  const ids: Id[] = [];
  const fresh = (prefix: string) => {
    const id = eid(prefix);
    ids.push(id);
    return id;
  };
  const xy = <T extends { x: number; y: number }>(o: T): T => {
    const [x, y] = move([o.x, o.y]);
    return { ...o, x, y };
  };
  let tracks: Track[] = clip.tracks.map((t) => ({ ...t, id: fresh("tr"), pts: t.pts.map(move) }));
  let vias: Via[] = clip.vias.map((v) => ({ ...xy(v), id: fresh("vi") }));
  const pours: Pour[] = clip.pours.map((p) => ({ ...p, id: fresh("po"), outline: p.outline.map(move) }));

  // Nets: through the matching pads when laying out a channel, else from the copper each piece lands on.
  const { tracks: t2, vias: v2, offNet } = nets(d, pads, tracks, vias, netOf);
  tracks = t2;
  vias = v2;
  const known = new Set(pads.map((p) => p.net).filter(Boolean));
  const pourNets = pours.map((p) => ({ ...p, net: (netOf ? netOf(p.net) : undefined) ?? (known.has(p.net) ? p.net : "") }));

  const board: Board = {
    ...b,
    placements,
    tracks: [...b.tracks, ...tracks],
    vias: [...b.vias, ...vias],
    pours: [...b.pours, ...pourNets],
    keepouts: [...b.keepouts, ...clip.keepouts.map((k) => ({ ...k, id: fresh("ko"), outline: k.outline.map(move) }))],
    texts: [...b.texts, ...clip.texts.map((t) => ({ ...xy(t), id: fresh("tx"), ...(turn || t.angle ? { angle: ((t.angle ?? 0) + turn) % 360 } : {}) }))],
    holes: [...b.holes, ...clip.holes.map((h) => ({ ...xy(h), id: fresh("h") }))],
  };
  if (clip.pictures.length) board.pictures = [...(b.pictures ?? []), ...clip.pictures.map((p) => ({ ...xy(p), id: fresh("pic") }))];
  if (clip.marks.length) {
    const used = new Set((b.marks ?? []).map((m) => m.ref));
    const next = (kind: BoardMark["kind"]) => {
      const prefix = kind === "fiducial" ? "FID" : "TP";
      let n = 1;
      while (used.has(`${prefix}${n}`)) n += 1;
      used.add(`${prefix}${n}`);
      return `${prefix}${n}`;
    };
    board.marks = [
      ...(b.marks ?? []),
      ...clip.marks.map((m) => {
        const net = m.net && (netOf ? netOf(m.net) : known.has(m.net) ? m.net : undefined);
        const out: BoardMark = { ...xy(m), id: fresh("mk"), ref: next(m.kind) };
        if (net) out.net = net;
        else delete out.net;
        return out;
      }),
    ];
  }
  const why =
    !paired && clip.parts.length ? "Parts come from the schematic, so they were not pasted. Pick the matching parts and paste to lay them out." : undefined;
  return { design: { ...d, board }, ids, offNet, laid, ...(why ? { why } : {}) };
}

/**
 * Gives pasted tracks and vias their nets. Pieces that touch are one run; a run takes the net of the board's copper it
 * lands on, if that is one net, else it is on no net. Laying out a channel, nets go through `netOf` first.
 */
function nets(
  d: ElectronicsDesign,
  pads: BoardPad[],
  tracks: Track[],
  vias: Via[],
  netOf: ((net: string) => string | undefined) | null,
): { tracks: Track[]; vias: Via[]; offNet: number } {
  const b = d.board!;
  const all = layersOf(b);
  const there: Copper[] = copperOf(d, pads).filter((c) => c.net);
  type Piece = { kind: "track"; i: number; layers: Layer[]; pts: P2[]; net: string } | { kind: "via"; i: number; layers: Layer[]; pts: P2[]; net: string };
  const pieces: Piece[] = [
    ...tracks.map((t, i): Piece => ({ kind: "track", i, layers: [t.layer], pts: t.pts, net: t.net })),
    ...vias.map((v, i): Piece => ({ kind: "via", i, layers: viaLayers(b, v), pts: [[v.x, v.y]], net: v.net })),
  ];
  // Runs: pieces that share an end on a layer.
  const parent = pieces.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const ends = new Map<string, number>();
  pieces.forEach((p, i) => {
    const tips = p.kind === "track" ? [p.pts[0]!, p.pts[p.pts.length - 1]!] : p.pts;
    for (const tip of tips)
      for (const l of p.layers) {
        const k = `${l}|${key(tip[0], tip[1])}`;
        const other = ends.get(k);
        if (other === undefined) ends.set(k, i);
        else parent[find(i)] = find(other);
      }
  });
  const runNet = new Map<number, string | null>();
  pieces.forEach((p, i) => {
    const root = find(i);
    let net: string | undefined;
    if (netOf) net = netOf(p.net);
    else {
      const hit = there.find((c) => c.layers.some((l) => p.layers.includes(l) && all.includes(l)) && p.pts.some((tip) => gap({ pts: [tip], r: 0 }, c) === 0));
      net = hit?.net;
    }
    if (net === undefined) return;
    const was = runNet.get(root);
    runNet.set(root, was === undefined || was === net ? net : null);
  });
  let offNet = 0;
  const netFor = (i: number) => {
    const n = runNet.get(find(i));
    if (!n) offNet += 1;
    return n ?? "";
  };
  const outTracks = tracks.map((t, i) => ({ ...t, net: netFor(i) }));
  const outVias = vias.map((v, i) => ({ ...v, net: netFor(tracks.length + i) }));
  return { tracks: outTracks, vias: outVias, offNet };
}

/** Whether something from the browser's store is a board clip. */
export function isBoardClip(c: unknown): c is BoardClip {
  const x = c as BoardClip | null;
  return !!x && x.kind === "board" && Array.isArray(x.tracks) && Array.isArray(x.vias) && Array.isArray(x.parts);
}
