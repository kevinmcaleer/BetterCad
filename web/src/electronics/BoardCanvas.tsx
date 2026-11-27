import { useEffect, useMemo, useRef, useState } from "react";
import {
  boardSize,
  eid,
  emptyBox,
  flipOnBoard,
  grow,
  moveOnBoard,
  netlist,
  outlinePoints,
  boardGroups,
  pickGroups,
  ratsnest,
  removeFromBoard,
  rotateOnBoard,
  type Box,
  type ElectronicsDesign,
  type P2,
} from "@bettercad/electronics";
import { clearanceBetween, copperOf, edgeLoops, netRules, type Layer } from "@bettercad/electronics/pcb/copper";
import { layersOf } from "@bettercad/electronics/pcb/stack";
import { boardState } from "@bettercad/electronics/pcb/state";
import { addPicture } from "@bettercad/electronics/pcb/picture";
import { addMark } from "@bettercad/electronics/pcb/marks";
import { teardrops } from "@bettercad/electronics/pcb/teardrops";
import { slideTrack } from "@bettercad/electronics/pcb/slide";
import { addCutout, addKeepoutArea, addPour, pourShape, removeAreas, wholeBoard } from "@bettercad/electronics/pcb/pour";
import {
  addHole,
  addText,
  addTrack,
  addVia,
  blockers,
  clearRoutes,
  corner45,
  deleteParts,
  renumberOnBoard,
  tidyRun,
  toggleLock,
  trackLength,
} from "@bettercad/electronics/pcb/route";
import { layPair, netLength, pairOf, pairRuns, shove } from "@bettercad/electronics/pcb/shove";
import { Button, ESC, NumberField, useEscape } from "@bettercad/ui";
import { eactions, type EEdit } from "./actions";
import { Canvas2D, type Canvas2DApi, type Pointer } from "./Canvas2D";
import { readColours } from "./colours";
import { drawBoard, type LayerId } from "./drawBoard";
import { getBoardClip, setBoardClip } from "./clip";
import { boxBoard, handleAt, handlesOf, hitBoard, placementBox } from "./hitBoard";
import { addAreaCorner, moveAreaCorner, moveTrackCorner, removeAreaCorner } from "@bettercad/electronics/pcb/corners";
import { measureSnap, measureText } from "./measure";
import { clearOf } from "./SchematicCanvas";
import { eui } from "./ui";
import { useEui } from "./useEui";
import { fit, snap, type View2D } from "./view2d";

let camera: View2D | null = null;
let run = 0;
/** Track widths offered while routing, mm. The first choice is the net's own, from the rules. */
const WIDTHS = [0.15, 0.2, 0.25, 0.4, 0.5, 0.8, 1, 1.5];

/** The board and everything parked beside it, boxed, for Fit. */
export function boardBox(d: ElectronicsDesign, only?: Set<string>): Box {
  const b = emptyBox();
  const board = d.board;
  if (!board) return { x1: 0, y1: 0, x2: 50, y2: 40 };
  if (!only) for (const p of outlinePoints(board.outline)) grow(b, p);
  for (const at of board.placements) {
    if (only && !only.has(at.part)) continue;
    const pb = placementBox(d, at);
    if (pb) grow(grow(b, [pb.x1, pb.y1], only ? 3 : 0), [pb.x2, pb.y2], only ? 3 : 0);
  }
  for (const t of board.tracks) if (only?.has(t.id)) for (const p of t.pts) grow(b, p, 2);
  for (const v of board.vias) if (only?.has(v.id)) grow(b, [v.x, v.y], 3);
  for (const h of board.holes) if (only?.has(h.id)) grow(b, [h.x, h.y], 4);
  for (const t of board.texts) if (only?.has(t.id)) grow(b, [t.x, t.y], 4);
  for (const pic of board.pictures ?? []) if (only?.has(pic.id)) grow(grow(b, [pic.x, pic.y], 2), [pic.x + pic.w, pic.y + (pic.w / pic.cols) * pic.rows], 2);
  if (b.x1 === Infinity) return boardBox(d);
  return b;
}

/** The nearest point of a line to `p`. */
function onLine(p: P2, a: P2, b: P2): P2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return [a[0] + t * dx, a[1] + t * dy];
}

/** A track being laid: its net, where it has got to, and which way the next bend goes. */
interface Routing {
  net: string;
  last: P2;
  diag: boolean;
  /** Routing two tracks together (#646): the other net, where each started, and the line they run either side of. */
  pair?: { net: string; ids: [string, string]; a: P2; b: P2; centre: P2[] };
}

/** How far to look for the other pad of a pair, mm. */
const PAIR_REACH = 8;
const mm = (n: number) => Math.round(n * 100) / 100;

export interface BoardCanvasProps {
  design: ElectronicsDesign;
  edit: EEdit;
  readOnly?: boolean;
}

/**
 * The cards' insets, and the Layers card's too where it stands open beside the board (not as a chip on a phone) and
 * the view is wide enough to give it a column: Fit then shows the whole board, with nothing under the card.
 */
function clearOfLayers(host: Element | null, width: number) {
  const clear = clearOf(host);
  const card = document.querySelector(".bc-ec-layers")?.getBoundingClientRect();
  const all = host?.getBoundingClientRect();
  if (!card || !all || card.height < 120) return clear;
  const right = all.right - card.left;
  return width - clear.left - right >= 360 ? { ...clear, right: Math.max(clear.right, right) } : clear;
}

/**
 * The PCB (#617, #639, #640): the board, its parts, copper and the lines still to route. Select, move, turn and flip
 * parts; route tracks with 45° bends that stop at anything they must keep clear of; drop vias, holes and text.
 */
export function BoardCanvas({ design, edit, readOnly }: BoardCanvasProps) {
  const ui = useEui();
  const api = useRef<Canvas2DApi>(null);
  const host = useRef<HTMLDivElement>(null);
  const [view, setViewState] = useState<View2D>(() => camera ?? { scale: 8, ox: 300, oy: 500 });
  const [, setSized] = useState(0);
  const fitted = useRef(!!camera);
  const setView = (v: View2D) => {
    camera = v;
    setViewState(v);
  };
  const [hover, setHover] = useState<string | null>(null);
  const [at, setAt] = useState<P2 | null>(null);
  const [box, setBox] = useState<[P2, P2] | null>(null);
  const [route, setRoute] = useState<Routing | null>(null);
  const [width, setWidth] = useState(0);
  const [target, setTarget] = useState(0);
  const [paired, setPaired] = useState(false);
  const [said, setSaid] = useState("");
  const [ask, setAsk] = useState<{ at: P2; screen: P2 } | null>(null);
  const [text, setText] = useState("");
  const [area, setArea] = useState<P2[]>([]);
  const [pourNet, setPourNet] = useState("");
  const [cut, setCut] = useState(false);
  const [going, setGoing] = useState<string[] | null>(null);
  /** The points picked with Measure (#732): none, the first, or both. */
  const [measured, setMeasured] = useState<P2[]>([]);
  const drag = useRef<{
    ids: string[];
    last: P2;
    key: string;
    slide?: { id: string; piece: number; from: P2; board: NonNullable<ElectronicsDesign["board"]> };
    /** A corner held (#742): a track's bend or an area's corner, worked out from the board as it was picked up. */
    corner?: { kind: "track" | "area"; id: string; i: number; design: ElectronicsDesign };
  } | null>(null);
  /** The corner last picked, for Delete. */
  const [corner, setCorner] = useState<{ id: string; i: number } | null>(null);
  const pictureFile = useRef<HTMLInputElement>(null);
  /** A picture for the silkscreen (#642): read, turned into ink, and set down in the middle of what is showing. */
  const addPictureFrom = async (file: File | undefined) => {
    if (!file || !design.board) return;
    try {
      const { pictureFromFile } = await import("./pictureFile");
      const size = boardSize(design.board);
      const w = Math.max(5, Math.min(20, Math.round(size.w / 3)));
      const ink = await pictureFromFile(file, w);
      const mid = [size.x + size.w / 2, size.y + size.h / 2];
      const h = (w / ink.cols) * ink.rows;
      const at = snap([mid[0] - w / 2, mid[1] - h / 2], grid);
      const id = eid("pi");
      const side = layer === "bottom" ? "silk-bottom" : "silk-top";
      edit((d) => addPicture(d, { ...ink, layer: side, x: at[0], y: at[1], w }, id), "Add a picture");
      eui.set({ selected: [id], pcbTool: "select" });
      setSaid("");
    } catch (e) {
      setSaid((e as Error).message || "That picture could not be read.");
    }
  };
  // What is wrong with where the picked parts sit (#639), found as they move. The check's code loads once, apart.
  const [findClashes, setFindClashes] = useState<typeof import("@bettercad/electronics/drc").placeClashes | null>(null);
  useEffect(() => {
    let live = true;
    void import("@bettercad/electronics/drc").then((m) => live && setFindClashes(() => m.placeClashes));
    return () => {
      live = false;
    };
  }, []);

  const board = design.board;
  const nl = useMemo(() => netlist(design), [design]);
  const state = useMemo(() => boardState(design, nl), [design, nl]);
  const { pads, copper } = state;
  const drops = useMemo(() => teardrops(design, pads, copper), [design, pads, copper]);
  const pours = useMemo(() => state.fills.map((fill) => ({ fill, shape: pourShape(design, fill.pour, pads, copper) })), [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const nets = useMemo(() => [...new Set(pads.map((p) => p.net).filter(Boolean))].sort(), [pads]);
  const fillNet = nets.includes(pourNet) ? pourNet : (nets.find((n) => /^(gnd|ground|0v|vss)$/i.test(n)) ?? nets[0] ?? "");
  const air = useMemo(() => ratsnest(state.pads, state.joined), [state]);
  const loops = useMemo(() => (board ? edgeLoops(board) : []), [board]);
  const selected = useMemo(() => new Set(ui.selected), [ui.selected]);
  const groupLines = useMemo(() => boardGroups(design, selected), [design, selected]);
  const hidden = useMemo(() => new Set<LayerId>(ui.hidden), [ui.hidden]);
  const colours = useMemo(() => readColours(host.current), [host.current, ui.view]); // eslint-disable-line react-hooks/exhaustive-deps
  // Measuring changes nothing, so it works on a board you can only look at.
  const tool = !board || (readOnly && ui.pcbTool !== "measure") ? "select" : ui.pcbTool;
  const layers = useMemo(() => (board ? layersOf(board) : (["top", "bottom"] as Layer[])), [board]);
  const layer: Layer = layers.includes(ui.layer) ? ui.layer : "top";
  /** The layer after this one, going down through the board and round to the top again. */
  const nextLayer = layers[(layers.indexOf(layer) + 1) % layers.length]!;
  const grid = ui.grid;

  // The status strip and the switcher say how much is left to route, with the copper counted.
  useEffect(() => {
    const airs: Record<string, number> = {};
    for (const a of air) airs[a.net] = (airs[a.net] ?? 0) + 1;
    const was = eui.get().airs;
    const same = was && Object.keys(was).length === Object.keys(airs).length && Object.entries(airs).every(([n, k]) => was[n] === k);
    if (eui.get().unrouted !== air.length || !same) eui.set({ unrouted: air.length, ...(same ? {} : { airs }) });
  }, [air]);
  const onCopper = (board?.tracks.length ?? 0) + (board?.vias.length ?? 0);
  useEffect(() => {
    if (eui.get().routed !== onCopper) eui.set({ routed: onCopper });
  }, [onCopper]);
  useEffect(() => () => eui.set({ unrouted: null, airs: null, routed: null }), []);
  useEffect(() => {
    if (tool !== "route") setRoute(null);
    setArea([]);
    setMeasured([]);
    setSaid("");
  }, [tool]);

  const doFit = (only?: Set<string>) => {
    const size = api.current?.size();
    if (!size || size.w < 10) return false;
    const v = fit(boardBox(design, only), size, clearOfLayers(host.current, size.w));
    setView(only ? { ...v, scale: Math.min(v.scale, 40) } : v);
    return true;
  };
  useEffect(() => {
    if (!fitted.current && design.board) fitted.current = doFit();
  });
  const focus = useRef(ui.focus);
  useEffect(() => {
    if (ui.focus !== focus.current) {
      focus.current = ui.focus;
      if (ui.selected.length) doFit(new Set(ui.selected));
    }
  });
  // A check's result was clicked: bring its spot into the middle.
  const spotted = useRef(0);
  useEffect(() => {
    const spot = ui.spot;
    const size = api.current?.size();
    if (!spot || spot.sheet !== "board" || spot.n === spotted.current || !size) return;
    spotted.current = spot.n;
    const v = fit({ x1: spot.at[0] - 6, y1: spot.at[1] - 6, x2: spot.at[0] + 6, y2: spot.at[1] + 6 }, size, clearOf(host.current));
    setView({ ...v, scale: Math.min(v.scale, 40) });
  });

  const tol = 5 / view.scale;
  const shown = (l: Layer) => !hidden.has(l as LayerId);
  /** A part wins over its own pads, so a click on a pad picks the part; copper and holes win over parts. */
  const hitAt = (p: P2) => {
    const hits = hitBoard(design, pads, p, tol, shown, ui.pick);
    const small = (h: (typeof hits)[number]) => h.kind !== "pad" && h.kind !== "part" && h.kind !== "area";
    return hits.find(small) ?? hits.find((h) => h.kind === "part") ?? hits.find((h) => h.kind === "pad") ?? hits.find((h) => h.kind === "area");
  };
  /** The copper with a net under a point: where a track can start or end. */
  const copperAt = (p: P2, net?: string): { net: string; at: P2; layer?: Layer } | null => {
    for (const h of hitBoard(design, pads, p, Math.max(tol, 0.3), shown)) {
      if (!h.net || (net !== undefined && h.net !== net)) continue;
      if (h.kind === "pad" && h.pad) return { net: h.net, at: h.pad.at, layer: h.pad.pad.kind === "smd" ? h.pad.side : undefined };
      const via = h.kind === "via" && board?.vias.find((v) => v.id === h.id);
      if (via) return { net: h.net, at: [via.x, via.y] };
      const t = h.kind === "track" && board?.tracks.find((x) => x.id === h.id);
      if (t && layers.includes(t.layer)) {
        const a = t.pts[h.segment ?? 0]!;
        const b = t.pts[(h.segment ?? 0) + 1]!;
        // An end if the pointer is near one, else the grid point nearest along the track.
        const near = [a, b].find((e) => Math.hypot(e[0] - p[0], e[1] - p[1]) <= Math.max(tol, t.width));
        return { net: h.net, at: near ?? onLine(snap(p, grid), a, b), layer: t.layer };
      }
    }
    return null;
  };
  /** Where the next corner of the track would go: onto its own net's copper if the pointer is on some, else the grid. */
  const aim = (p: P2, r: Routing): { to: P2; lands: boolean } => {
    const on = copperAt(p, r.net);
    if (on && (!on.layer || on.layer === layer) && Math.hypot(on.at[0] - r.last[0], on.at[1] - r.last[1]) > 1e-6) return { to: on.at, lands: true };
    return { to: snap(p, grid), lands: false };
  };
  const widthOf = (net: string) => width || (board ? netRules(board, net).trackWidth : 0.25);
  const inWay = (net: string, layers: Layer[], pts: P2[], w: number) =>
    board && ui.keepClear ? blockers(board, copper, loops, { net, layers, pts, width: w })[0] : undefined;
  const tooClose = (what: string) => setSaid(`Too close to ${what}. Go round it, or turn Keep clear off.`);

  /** With Push on: whether other tracks can move aside to let this run through (#646). */
  const canPush = (net: string, pts: P2[], w: number): boolean => {
    if (!ui.shove || !board) return false;
    const made = shove(design, { net, layer, pts, width: w }, pads);
    return !!made?.board && made !== design && !blockers(made.board, copperOf(made, pads), loops, { net, layers: [layer], pts, width: w }).length;
  };
  /** The way to `to`: bent the way asked for, or the other way if only that one is clear, or pushing through. */
  const way = (r: Routing, to: P2): { pts: P2[]; stop?: { what: string }; push?: boolean } => {
    const w = widthOf(r.net);
    const first = corner45(r.last, to, r.diag);
    const stop = inWay(r.net, [layer], first, w);
    if (!stop) return { pts: first };
    const other = corner45(r.last, to, !r.diag);
    if (first.length > 2 && !inWay(r.net, [layer], other, w)) return { pts: other };
    if (canPush(r.net, first, w)) return { pts: first, push: true };
    if (first.length > 2 && canPush(r.net, other, w)) return { pts: other, push: true };
    return { pts: first, stop };
  };
  /** The nearest pad of a net to a point, within reach of a pair. */
  const padNear = (net: string, at: P2): P2 | undefined =>
    pads
      .filter((p) => p.net === net && Math.hypot(p.at[0] - at[0], p.at[1] - at[1]) <= PAIR_REACH)
      .sort((x, y) => Math.hypot(x.at[0] - at[0], x.at[1] - at[1]) - Math.hypot(y.at[0] - at[0], y.at[1] - at[1]))[0]?.at;
  /** The two tracks of a pair, on to `p`: both runs, and what is in the way of them if anything. */
  const pairWay = (r: Routing, p: P2) => {
    const pr = r.pair!;
    const on = copperAt(p, r.net) ?? copperAt(p, pr.net);
    let to = snap(p, grid);
    let ends: { a?: P2; b?: P2 } = {};
    const far = (x: P2, y: P2) => Math.hypot(x[0] - y[0], x[1] - y[1]) > 1e-6;
    if (on && far(on.at, pr.a) && far(on.at, pr.b)) {
      const mate = padNear(on.net === r.net ? pr.net : r.net, on.at);
      if (mate) {
        to = [(on.at[0] + mate[0]) / 2, (on.at[1] + mate[1]) / 2];
        ends = on.net === r.net ? { a: on.at, b: mate } : { a: mate, b: on.at };
      }
    }
    const w = widthOf(r.net);
    const pitch = w + (board ? clearanceBetween(board, r.net, pr.net) : 0.2);
    const others = copper.filter((c) => !pr.ids.includes(c.id));
    let found: { centre: P2[]; runs: { a: P2[]; b: P2[] }; stop?: { what: string } } | undefined;
    for (const diag of [r.diag, !r.diag]) {
      const centre = tidyRun([...pr.centre, ...corner45(r.last, to, diag).slice(1)]);
      const runs = pairRuns(centre, pitch, { from: pr.a, to: ends.a }, { from: pr.b, to: ends.b });
      if (!runs) continue;
      const stop =
        board && ui.keepClear
          ? (blockers(board, others, loops, { net: r.net, layers: [layer], pts: runs.a, width: w })[0] ??
            blockers(board, others, loops, { net: pr.net, layers: [layer], pts: runs.b, width: w })[0])
          : undefined;
      if (!found || !stop) found = { centre, runs, stop };
      if (!stop) break;
    }
    return { to, lands: !!ends.a, w, found };
  };
  /** Lays the track on to `p`: the routing to carry on with, null when it landed, false when something is in the way. */
  const extend = (r: Routing, p: P2): Routing | null | false => {
    if (r.pair) {
      const pr = r.pair;
      const { to, lands, w, found } = pairWay(r, p);
      if (Math.hypot(to[0] - r.last[0], to[1] - r.last[1]) < 1e-6) return r;
      if (!found) {
        setSaid("That turn is too tight for the pair. Click further on.");
        return false;
      }
      if (found.stop) {
        tooClose(found.stop.what);
        return false;
      }
      setSaid("");
      edit((d) => layPair(d, pr.ids, [r.net, pr.net], layer, found.runs, w), "Route a pair");
      return lands ? null : { ...r, last: to, pair: { ...pr, centre: found.centre } };
    }
    const { to, lands } = aim(p, r);
    if (Math.hypot(to[0] - r.last[0], to[1] - r.last[1]) < 1e-6) return r;
    const { pts, stop, push } = way(r, to);
    if (stop) {
      tooClose(stop.what);
      return false;
    }
    setSaid("");
    const w = widthOf(r.net);
    if (push) edit((d) => addTrack(shove(d, { net: r.net, layer, pts, width: w }) ?? d, r.net, layer, pts, w), "Route a track and push others aside");
    else edit((d) => addTrack(d, r.net, layer, pts, w), "Route a track");
    return lands ? null : { ...r, last: to };
  };
  /** Drops a via where the track has got to and carries on on the other side. */
  const viaHere = () => {
    if (!board) return;
    if (!route) return eui.set({ layer: nextLayer });
    if (route.pair) return setSaid("A pair stays on one side. Finish it first.");
    const stop = inWay(route.net, layers, [route.last], netRules(board, route.net).viaDiameter);
    if (stop) return tooClose(stop.what);
    edit((d) => addVia(d, route.net, route.last[0], route.last[1]), "Add a via");
    eui.set({ layer: nextLayer });
  };

  /** Closes the area being drawn into a pour, a keep-out or a cut-out. */
  const closeArea = (pts: P2[] = area) => {
    setArea([]);
    if (pts.length < 3) return setSaid("An area needs three corners or more.");
    setSaid("");
    if (tool === "pour") {
      if (!fillNet) return setSaid("There is no net to pour yet. Wire the schematic first.");
      edit((d) => addPour(d, fillNet, layer, pts), "Add a pour");
    } else if (cut) edit((d) => addCutout(d, pts), "Cut a hole in the board");
    else edit((d) => addKeepoutArea(d, pts), "Add a keep-out");
  };

  const pickGroup = () => {
    const placed = new Set(design.board?.placements.map((p) => p.part));
    const ids = pickGroups(design, eui.get().selected).filter((id) => placed.has(id) || eui.get().selected.includes(id));
    eui.set({ selected: ids, net: null });
  };
  useEffect(() => {
    const picked = () => eui.get().selected;
    /** Copy, paste and duplicate (#741): the sums load the first time they are asked for. */
    const clipboard = () => import("@bettercad/electronics/pcb/clip");
    const paste = async (beside: boolean) => {
      if (readOnly || !board) return;
      const { copyBoard, boardClipOrigin, pasteBoard } = await clipboard();
      const clip = beside ? copyBoard(design, picked()) : getBoardClip();
      if (!clip) return;
      // Onto picked parts that match the copy's, the copy lays them out; else under the pointer, or beside it.
      const from = boardClipOrigin(clip);
      const to: P2 = !beside && at ? snap(at, grid) : [from[0] + 5 * grid, from[1] + 5 * grid];
      const made = pasteBoard(design, clip, to, beside ? [] : picked());
      if (!made.ids.length && !made.laid) return setSaid(made.why ?? "There was nothing to paste.");
      edit(() => made.design, beside ? "Duplicate" : made.laid ? "Lay out like the copy" : "Paste");
      eui.set({ selected: made.laid ? picked() : made.ids });
      setSaid(
        [
          made.laid ? `Laid out ${made.laid} ${made.laid === 1 ? "part" : "parts"} like the copy.` : "",
          made.offNet
            ? `${made.offNet} ${made.offNet === 1 ? "piece" : "pieces"} of copper landed on nothing and ${made.offNet === 1 ? "is" : "are"} on no net.`
            : "",
          made.why ?? "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    };
    eactions.current = {
      copy: async () => {
        const { copyBoard } = await clipboard();
        const clip = copyBoard(design, picked());
        if (clip) setBoardClip(clip);
      },
      paste: () => void paste(false),
      duplicate: () => void paste(true),
      fit: () => doFit(),
      rotate: () => !readOnly && picked().length && edit((d) => rotateOnBoard(d, picked()), "Rotate"),
      mirror: () => !readOnly && picked().length && edit((d) => flipOnBoard(d, picked()), "Flip to the other side"),
      remove: () => {
        if (readOnly || !picked().length) return;
        // A picked corner of an area goes on its own, while the area keeps three (#742).
        if (corner && picked().length === 1 && picked()[0] === corner.id && board && handlesOf(board, corner.id)?.kind === "area") {
          edit((d) => removeAreaCorner(d, corner.id, corner.i), "Delete a corner");
          return setCorner(null);
        }
        const parts = new Set(design.board?.placements.map((p) => p.part));
        const rest = picked().filter((id) => !parts.has(id));
        const mine = picked().filter((id) => parts.has(id));
        if (rest.length) edit((d) => removeAreas(removeFromBoard(d, rest), rest), "Delete");
        eui.set({ selected: mine });
        // A part is the schematic's too, so that is asked first.
        setGoing(mine.length ? mine : null);
      },
      push: () => eui.set({ card: "changes" }),
      selectAll: () => eui.set({ selected: design.board?.placements.map((p) => p.part) ?? [] }),
      group: () => pickGroup(),
      groupToggle: () => pickGroup(),
      layer: viaHere,
      lock: () => !readOnly && picked().length && edit((d) => toggleLock(d, picked()), "Lock or unlock"),
      bend: () => route && setRoute({ ...route, diag: !route.diag }),
      renumber: () => !readOnly && edit(renumberOnBoard, "Renumber by the board"),
      clearRoutes: () => !readOnly && (board?.tracks.length || board?.vias.length) && edit(clearRoutes, "Clear routes"),
      picture: () => !readOnly && pictureFile.current?.click(),
    };
    return () => {
      eactions.current = null;
    };
  });
  useEscape(!!route, () => setRoute(null), ESC.drag);
  useEscape(area.length > 0, () => setArea([]), ESC.drag);
  useEscape(measured.length > 0, () => setMeasured([]), ESC.drag);
  useEscape(!!going, () => setGoing(null), ESC.overlay);
  useEscape(!!ask, () => setAsk(null), ESC.overlay);
  useEscape(tool !== "select", () => eui.set({ pcbTool: "select" }), ESC.tool);
  useEscape(tool === "select" && ui.selected.length > 0, () => eui.set({ selected: [], net: null }), ESC.selection);

  const onDown = (p: Pointer): boolean => {
    // The tools work by clicks, so a drag is free to pan on a touch screen.
    if (tool !== "select") return false;
    // A corner of the one picked track or area drags on its own; a press on an area's edge puts a new one there (#742).
    const one = ui.selected.length === 1 ? ui.selected[0]! : null;
    const h = one && board && !readOnly && !p.shift ? handleAt(board, one, p.world, Math.max(tol, 0.2)) : null;
    if (one && h) {
      const kind = handlesOf(board!, one)!.kind;
      const key = `ec-board-corner-${(run += 1)}`;
      let start = design;
      let i: number;
      if ("edge" in h) {
        const made = addAreaCorner(design, one, h.edge, snap(h.at, grid));
        start = made.design;
        i = made.i;
        edit(() => start, "Add a corner", key);
      } else i = h.i;
      setCorner({ id: one, i });
      drag.current = { ids: [one], last: snap(p.world, grid), key, corner: { kind, id: one, i, design: start } };
      return true;
    }
    setCorner(null);
    const hit = hitAt(p.world);
    if (!hit) {
      if (p.touch) return false;
      setBox([p.world, p.world]);
      return true;
    }
    let ids = ui.selected;
    if (p.shift) ids = ids.includes(hit.id) ? ids.filter((x) => x !== hit.id) : [...ids, hit.id];
    else if (!ids.includes(hit.id)) ids = [hit.id];
    eui.set({ selected: ids, net: hit.net || null, spot: null });
    if (!readOnly && ids.includes(hit.id)) {
      const from = snap(p.world, grid);
      drag.current = { ids, last: from, key: `ec-board-move-${(run += 1)}` };
      // One track, held by a piece of it: that piece slides and the rest of the track stays joined (#640).
      if (ids.length === 1 && hit.kind === "track" && hit.segment !== undefined && board) drag.current.slide = { id: hit.id, piece: hit.segment, from, board };
    }
    return true;
  };

  const onMove = (p: Pointer, dragging: boolean) => {
    if (tool !== "select") {
      if (!p.touch) setAt(p.world);
      return;
    }
    if (box && dragging) return setBox([box[0], p.world]);
    const d = drag.current;
    if (d && dragging) {
      const s = snap(p.world, grid);
      const dx = s[0] - d.last[0];
      const dy = s[1] - d.last[1];
      if (dx || dy) {
        d.last = s;
        const cn = d.corner;
        if (cn) {
          if (cn.kind === "area") edit(() => moveAreaCorner(cn.design, cn.id, cn.i, s), "Move a corner", d.key);
          else {
            // With Keep clear on, the bend stops at the last place where the track keeps its clearance.
            const next = moveTrackCorner(cn.design, cn.id, cn.i, s);
            const t = next.board?.tracks.find((x) => x.id === cn.id);
            const others = copper.filter((c) => c.id !== cn.id);
            const stop =
              t && board && ui.keepClear ? blockers(board, others, loops, { net: t.net, layers: [t.layer], pts: t.pts, width: t.width })[0] : undefined;
            if (stop) tooClose(stop.what);
            else {
              setSaid("");
              edit(() => next, "Move a corner", d.key);
            }
          }
          return;
        }
        const sl = d.slide;
        // A slide is always worked out from the track as it was picked up, so going back puts it back.
        if (sl) edit((x) => slideTrack({ ...x, board: sl.board }, sl.id, sl.piece, [s[0] - sl.from[0], s[1] - sl.from[1]]), "Move a piece of track", d.key);
        else edit((x) => moveOnBoard(x, d.ids, dx, dy), "Move", d.key);
      }
      return;
    }
    if (!p.touch) setHover(hitAt(p.world)?.id ?? null);
  };

  const click = (p: Pointer) => {
    if (!board) return;
    if (tool === "route") {
      if (route) {
        const next = extend(route, p.world);
        if (next !== false) setRoute(next);
        return;
      }
      const from = copperAt(p.world);
      if (!from) return setSaid("Start on a pad, a via or a track.");
      setSaid("");
      if (from.layer && from.layer !== layer) eui.set({ layer: from.layer });
      eui.set({ net: from.net, selected: [] });
      const mate = paired ? pairOf(from.net, nets) : null;
      const other = mate ? padNear(mate, from.at) : undefined;
      if (mate && other) {
        const mid: P2 = [(from.at[0] + other[0]) / 2, (from.at[1] + other[1]) / 2];
        return setRoute({ net: from.net, last: mid, diag: false, pair: { net: mate, ids: [eid("tr"), eid("tr")], a: from.at, b: other, centre: [mid] } });
      }
      if (paired)
        setSaid(
          mate
            ? `No ${mate} pad is near enough to pair with. Routing ${from.net} on its own.`
            : `${from.net} has no partner, such as D+ and D-. Routing it on its own.`,
        );
      setRoute({ net: from.net, last: from.at, diag: false });
    } else if (tool === "via") {
      const on = copperAt(p.world);
      const to = on?.at ?? snap(p.world, grid);
      const net = on?.net ?? "";
      const stop = inWay(net, layers, [to], netRules(board, net).viaDiameter);
      if (stop) return tooClose(stop.what);
      setSaid("");
      edit((d) => addVia(d, net, to[0], to[1]), "Add a via");
    } else if (tool === "measure") {
      // Two clicks measure; a third starts again from there.
      const { at: to } = measureSnap(design, pads, p.world, Math.max(tol, 0.5), grid);
      setMeasured(measured.length === 1 ? [measured[0]!, to] : [to]);
    } else if (tool === "hole") {
      const to = snap(p.world, grid);
      edit((d) => addHole(d, to[0], to[1], 3.2), "Add a hole");
    } else if (tool === "fiducial" || tool === "testpoint") {
      // A test point dropped on copper joins its net; it goes on the side you are working on.
      const on = tool === "testpoint" ? copperAt(p.world) : null;
      const to = on?.at ?? snap(p.world, grid);
      const side = layer === "bottom" ? "bottom" : "top";
      edit((d) => addMark(d, tool, to[0], to[1], side, on?.net).design, tool === "fiducial" ? "Add a fiducial" : "Add a test point");
      if (tool === "testpoint" && !on) setSaid("Test point added on no net. Pick its net on the right, or route a track to it.");
      else setSaid("");
    } else if (tool === "text") {
      setText("");
      setAsk({ at: snap(p.world, grid), screen: p.screen });
    } else if (tool === "pour" || tool === "keepout") {
      const to = snap(p.world, grid);
      const first = area[0];
      // Back on the first corner closes it.
      if (first && area.length > 2 && Math.hypot(first[0] - to[0], first[1] - to[1]) <= Math.max(tol, 1e-6)) return closeArea();
      const last = area[area.length - 1];
      if (last && last[0] === to[0] && last[1] === to[1]) return;
      setSaid("");
      setArea([...area, to]);
    }
  };

  const onUp = (p: Pointer, moved: boolean) => {
    if (tool !== "select") {
      if (!moved) click(p);
      return;
    }
    if (box) {
      if (moved) eui.set({ selected: boxBoard(design, box[0], p.world, ui.pick), net: null });
      else if (!p.shift) eui.set({ selected: [], net: null, spot: null });
      setBox(null);
    }
    drag.current = null;
  };

  // The corners the one picked track or area shows to drag (#742).
  const handles = useMemo(() => {
    const one = tool === "select" && !readOnly && ui.selected.length === 1 && board ? handlesOf(board, ui.selected[0]!) : null;
    return one ? { pts: one.handles.map((i) => one.pts[i]!), picked: corner?.id === ui.selected[0] ? one.handles.indexOf(corner.i) : undefined } : undefined;
  }, [board, ui.selected, tool, readOnly, corner]);
  // The piece of track that would go down on the next click.
  const ghost = useMemo(() => {
    if (!route || !at || !board) return undefined;
    if (route.pair) {
      const { w, found } = pairWay(route, at);
      if (!found) return undefined;
      return { track: { pts: found.runs.a, width: w, layer, blocked: !!found.stop }, mate: { pts: found.runs.b, width: w, layer, blocked: !!found.stop } };
    }
    const { pts, stop } = way(route, aim(at, route).to);
    return { track: { pts, width: widthOf(route.net), layer, blocked: !!stop } };
  }, [route, at, board, copper, layer, width, ui.keepClear, ui.shove, grid]); // eslint-disable-line react-hooks/exhaustive-deps
  /** How long a net is, with the piece on the pointer counted, against the target if there is one. */
  const lengthOf = (net: string, more: P2[] = []) => {
    const n = mm(netLength(design, net) + trackLength(more));
    return target ? `${n} of ${target} mm` : `${n} mm`;
  };
  const clashes = useMemo(
    () => (findClashes && tool === "select" && selected.size ? findClashes(design, selected) : []),
    [findClashes, tool, selected, design.board, design.parts], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const clashing = useMemo(() => new Set(clashes.flatMap((c) => c.parts)), [clashes]);
  const marks = useMemo(() => (ui.spot?.sheet === "board" ? [{ at: ui.spot.at }] : undefined), [ui.spot]);

  const drawing = useMemo(() => (area.length ? (at ? [...area, snap(at, grid)] : [...area, area[area.length - 1]!]) : undefined), [area, at, grid]);
  // The first point and the pointer while picking the second, then the two points picked.
  const measuring = useMemo(
    () => (measured.length === 1 && at ? [measured[0]!, measureSnap(design, pads, at, Math.max(tol, 0.5), grid).at] : measured),
    [measured, at, design, pads, tol, grid],
  );
  const asking = going?.every((id) => selected.has(id)) ? going : null;
  const goingNames = asking?.map((id) => design.parts.find((p) => p.id === id)?.ref ?? "").filter(Boolean) ?? [];

  const left = air.length;
  const hint =
    tool === "route"
      ? route
        ? route.pair
          ? `Routing ${route.net} and ${route.pair.net} as a pair: ${lengthOf(route.net)} and ${lengthOf(route.pair.net)}. Click to turn, click a pad to finish.`
          : `Routing ${route.net} on the ${layer} side, ${lengthOf(route.net, ghost?.track.pts)}. Click to turn, click a pad to finish.`
        : "Click a pad to start a track."
      : tool === "measure"
        ? measured.length === 2
          ? `${measureText(measured[0]!, measured[1]!)}. Click to measure again.`
          : measured.length === 1
            ? at
              ? `${measureText(measured[0]!, measureSnap(design, pads, at, Math.max(tol, 0.5), grid).at)}. Click the second point.`
              : "Click the second point."
            : "Click the first point. Pads, holes, track ends and the board's edge snap."
        : tool === "via"
          ? "Click a track or a pad to drop a via on it."
          : tool === "hole"
            ? "Click where the mounting hole goes."
            : tool === "fiducial"
              ? "Click where the fiducial goes. Put three near the board's corners, not in a line."
              : tool === "testpoint"
                ? "Click a track or a pad to put a test point on its net."
                : tool === "text"
                  ? "Click where the text starts."
                  : tool === "pour" || tool === "keepout"
                    ? area.length
                      ? "Click the next corner. Click the first corner again, or Done, to close it."
                      : tool === "pour"
                        ? `Click the corners of the area to fill on the ${layer} side, or fill the whole board.`
                        : cut
                          ? "Click the corners of the hole to cut through the board."
                          : "Click the corners of the area tracks and pours must stay out of."
                    : "";
  return (
    <div ref={host} className="bc-ec-host">
      <div className="bc-ec-clear" aria-hidden="true" />
      <Canvas2D
        onResize={() => !fitted.current && setSized((n) => n + 1)}
        api={api}
        label={
          design.board
            ? `PCB: ${design.board.placements.length} ${design.board.placements.length === 1 ? "part" : "parts"}, ${left} ${left === 1 ? "connection" : "connections"} left to route`
            : "PCB: no board yet"
        }
        view={view}
        onView={setView}
        cursor={tool !== "select" ? "crosshair" : hover ? "move" : "default"}
        drawKey={[
          design,
          selected,
          groupLines,
          hover,
          hidden,
          ui.layer,
          ui.net,
          box,
          colours,
          ghost,
          marks,
          air,
          pours,
          drawing,
          clashing,
          ui.pourOutlines,
          measuring,
          handles,
        ]}
        draw={(ctx, v, size) =>
          drawBoard(ctx, v, size, design, colours, {
            selected,
            hover,
            hidden,
            active: ui.layer,
            net: ui.net,
            pads,
            air,
            box,
            ghost,
            marks,
            clashing,
            pours,
            area: drawing,
            pourOutlines: ui.pourOutlines,
            measure: measuring,
            groups: groupLines,
            handles,
            teardrops: drops,
          })
        }
        onDown={onDown}
        onMove={onMove}
        onUp={onUp}
        onDouble={() => {
          if (route) setRoute(null);
          // The second click of the pair already added a corner where the first one did, or tried to.
          if (area.length > 2) closeArea();
        }}
      />
      {tool !== "select" && (
        <div className="bc-ec-routebar" role="group" aria-label="Tool options">
          <p role="status">{said || hint}</p>
          {tool === "route" && (
            <>
              <label>
                Width
                <select className="bc-select" value={width} onChange={(e) => setWidth(Number(e.target.value))}>
                  <option value={0}>By the rules</option>
                  {WIDTHS.map((w) => (
                    <option key={w} value={w}>
                      {w} mm
                    </option>
                  ))}
                </select>
              </label>
              <label className="bc-ec-fitted" data-tip="Stop a track at anything it must keep clear of">
                <input type="checkbox" checked={ui.keepClear} onChange={(e) => eui.set({ keepClear: e.target.checked })} />
                Keep clear
              </label>
              <label className="bc-ec-fitted" data-tip="Move other tracks aside when one is in the way">
                <input type="checkbox" checked={ui.shove} onChange={(e) => eui.set({ shove: e.target.checked })} />
                Push
              </label>
              <label className="bc-ec-fitted" data-tip="Route two nets side by side, such as D+ and D-">
                <input type="checkbox" checked={paired} disabled={!!route} onChange={(e) => setPaired(e.target.checked)} />
                Pair
              </label>
              <NumberField label="Target length" value={target || null} min={0} step={1} precision={2} onCommit={setTarget} />
              {route && (
                <>
                  <Button
                    size="dense"
                    variant="secondary"
                    icon="via"
                    label="Via"
                    shortcut="V"
                    title="Drop a via here and carry on on the other side"
                    onClick={viaHere}
                  />
                  <Button
                    size="dense"
                    variant="secondary"
                    label="Bend"
                    shortcut="/"
                    title="Bend the other way"
                    onClick={() => setRoute({ ...route, diag: !route.diag })}
                  />
                  <Button size="dense" variant="secondary" label="Done" title="Stop this track here (Esc)" onClick={() => setRoute(null)} />
                </>
              )}
            </>
          )}
          {tool === "pour" && (
            <>
              <label>
                Net
                <select className="bc-select" aria-label="Net to pour" value={fillNet} onChange={(e) => setPourNet(e.target.value)}>
                  {nets.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              {!area.length && board && (
                <Button
                  size="dense"
                  variant="secondary"
                  label="Whole board"
                  title={`Fill the whole ${layer} side with copper on this net`}
                  disabled={!fillNet}
                  onClick={() => edit((d) => (d.board ? addPour(d, fillNet, layer, wholeBoard(d.board)) : d), "Add a pour")}
                />
              )}
            </>
          )}
          {tool === "keepout" && !area.length && (
            <label>
              Make
              <select className="bc-select" aria-label="What the area makes" value={cut ? "cut" : "keep"} onChange={(e) => setCut(e.target.value === "cut")}>
                <option value="keep">A keep-out</option>
                <option value="cut">A hole in the board</option>
              </select>
            </label>
          )}
          {area.length > 0 && (
            <Button size="dense" variant="secondary" label="Done" title="Close the area" disabled={area.length < 3} onClick={() => closeArea()} />
          )}
        </div>
      )}
      <input
        ref={pictureFile}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
        hidden
        aria-label="A picture for the silkscreen"
        onChange={(e) => {
          void addPictureFrom(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {said && tool === "select" && clashes.length === 0 && !asking && (
        <div className="bc-ec-routebar" role="group" aria-label="Picture">
          <p role="status">{said}</p>
        </div>
      )}
      {clashes.length > 0 && !asking && (
        <div className="bc-ec-routebar" role="group" aria-label="Placing">
          <p role="status" className="bc-ec-blocked">
            {clashes
              .slice(0, 3)
              .map((c) => c.text)
              .join(" ")}
            {clashes.length > 3 ? ` And ${clashes.length - 3} more.` : ""}
          </p>
        </div>
      )}
      {asking && tool === "select" && (
        <div className="bc-ec-routebar" role="group" aria-label="Delete parts">
          <p role="status">
            {goingNames.length === 1 ? `Delete ${goingNames[0]} from the schematic too?` : `Delete these ${goingNames.length} parts from the schematic too?`} A
            part comes off the board when it comes off the schematic.
          </p>
          <Button
            size="dense"
            variant="danger"
            label="Delete"
            title="Take it off the board and the schematic, as one step you can undo"
            onClick={() => {
              const ids = asking;
              edit((d) => deleteParts(d, ids), goingNames.length === 1 ? `Delete ${goingNames[0]}` : "Delete parts");
              eui.set({ selected: [], net: null });
              setGoing(null);
            }}
          />
          <Button size="dense" variant="secondary" label="Keep" title="Leave it where it is (Esc)" onClick={() => setGoing(null)} />
        </div>
      )}
      {ask && (
        <form
          className="bc-ec-ask"
          style={{ left: ask.screen[0], top: ask.screen[1] }}
          onSubmit={(e) => {
            e.preventDefault();
            const side = layer === "bottom" ? "silk-bottom" : "silk-top";
            edit((d) => addText(d, ask.at[0], ask.at[1], text, side), "Add text");
            setAsk(null);
          }}
        >
          <input
            className="bc-text"
            aria-label="Text for the silkscreen"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setAsk(null)}
            placeholder="Text"
          />
        </form>
      )}
    </div>
  );
}
