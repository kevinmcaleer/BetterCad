import { useEffect, useMemo, useRef, useState } from "react";
import {
  emptyBox,
  flipOnBoard,
  grow,
  moveOnBoard,
  netlist,
  outlinePoints,
  ratsnest,
  removeFromBoard,
  rotateOnBoard,
  type Box,
  type ElectronicsDesign,
  type P2,
} from "@bettercad/electronics";
import { edgeLoops, netRules, type Layer } from "@bettercad/electronics/pcb/copper";
import { boardState } from "@bettercad/electronics/pcb/state";
import { addCutout, addKeepoutArea, addPour, pourShape, removeAreas, wholeBoard } from "@bettercad/electronics/pcb/pour";
import { addHole, addText, addTrack, addVia, blockers, corner45, deleteParts, renumberOnBoard, toggleLock } from "@bettercad/electronics/pcb/route";
import { Button, ESC, useEscape } from "@bettercad/ui";
import { eactions, type EEdit } from "./actions";
import { Canvas2D, type Canvas2DApi, type Pointer } from "./Canvas2D";
import { readColours } from "./colours";
import { drawBoard, type LayerId } from "./drawBoard";
import { boxBoard, hitBoard, placementBox } from "./hitBoard";
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
}

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
  const [said, setSaid] = useState("");
  const [ask, setAsk] = useState<{ at: P2; screen: P2 } | null>(null);
  const [text, setText] = useState("");
  const [area, setArea] = useState<P2[]>([]);
  const [pourNet, setPourNet] = useState("");
  const [cut, setCut] = useState(false);
  const [going, setGoing] = useState<string[] | null>(null);
  const drag = useRef<{ ids: string[]; last: P2; key: string } | null>(null);
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
  const pours = useMemo(() => state.fills.map((fill) => ({ fill, shape: pourShape(design, fill.pour, pads, copper) })), [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const nets = useMemo(() => [...new Set(pads.map((p) => p.net).filter(Boolean))].sort(), [pads]);
  const fillNet = nets.includes(pourNet) ? pourNet : (nets.find((n) => /^(gnd|ground|0v|vss)$/i.test(n)) ?? nets[0] ?? "");
  const air = useMemo(() => ratsnest(state.pads, state.joined), [state]);
  const loops = useMemo(() => (board ? edgeLoops(board) : []), [board]);
  const selected = useMemo(() => new Set(ui.selected), [ui.selected]);
  const hidden = useMemo(() => new Set<LayerId>(ui.hidden), [ui.hidden]);
  const colours = useMemo(() => readColours(host.current), [host.current, ui.view]); // eslint-disable-line react-hooks/exhaustive-deps
  const tool = readOnly || !board ? "select" : ui.pcbTool;
  const layer: Layer = ui.layer === "bottom" ? "bottom" : "top";
  const grid = ui.grid;

  // The status strip and the switcher say how much is left to route, with the copper counted.
  useEffect(() => {
    if (eui.get().unrouted !== air.length) eui.set({ unrouted: air.length });
  }, [air.length]);
  useEffect(() => () => eui.set({ unrouted: null }), []);
  useEffect(() => {
    if (tool !== "route") setRoute(null);
    setArea([]);
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
  const shown = (l: "top" | "bottom") => !hidden.has(l);
  /** A part wins over its own pads, so a click on a pad picks the part; copper and holes win over parts. */
  const hitAt = (p: P2) => {
    const hits = hitBoard(design, pads, p, tol, shown);
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
      if (t && (t.layer === "top" || t.layer === "bottom")) {
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

  /** The way to `to`: bent the way asked for, or the other way if only that one is clear. */
  const way = (r: Routing, to: P2): { pts: P2[]; stop?: { what: string } } => {
    const w = widthOf(r.net);
    const first = corner45(r.last, to, r.diag);
    const stop = inWay(r.net, [layer], first, w);
    if (!stop || first.length < 3) return { pts: first, stop };
    const other = corner45(r.last, to, !r.diag);
    return inWay(r.net, [layer], other, w) ? { pts: first, stop } : { pts: other };
  };
  /** Lays the track on to `p`: the routing to carry on with, null when it landed, false when something is in the way. */
  const extend = (r: Routing, p: P2): Routing | null | false => {
    const { to, lands } = aim(p, r);
    if (Math.hypot(to[0] - r.last[0], to[1] - r.last[1]) < 1e-6) return r;
    const { pts, stop } = way(r, to);
    if (stop) {
      tooClose(stop.what);
      return false;
    }
    setSaid("");
    edit((d) => addTrack(d, r.net, layer, pts, widthOf(r.net)), "Route a track");
    return lands ? null : { ...r, last: to };
  };
  /** Drops a via where the track has got to and carries on on the other side. */
  const viaHere = () => {
    if (!board) return;
    if (!route) return eui.set({ layer: layer === "top" ? "bottom" : "top" });
    const stop = inWay(route.net, ["top", "bottom"], [route.last], netRules(board, route.net).viaDiameter);
    if (stop) return tooClose(stop.what);
    edit((d) => addVia(d, route.net, route.last[0], route.last[1]), "Add a via");
    eui.set({ layer: layer === "top" ? "bottom" : "top" });
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

  useEffect(() => {
    const picked = () => eui.get().selected;
    eactions.current = {
      fit: () => doFit(),
      rotate: () => !readOnly && picked().length && edit((d) => rotateOnBoard(d, picked()), "Rotate"),
      mirror: () => !readOnly && picked().length && edit((d) => flipOnBoard(d, picked()), "Flip to the other side"),
      remove: () => {
        if (readOnly || !picked().length) return;
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
      layer: viaHere,
      lock: () => !readOnly && picked().length && edit((d) => toggleLock(d, picked()), "Lock or unlock"),
      bend: () => route && setRoute({ ...route, diag: !route.diag }),
      renumber: () => !readOnly && edit(renumberOnBoard, "Renumber by the board"),
    };
    return () => {
      eactions.current = null;
    };
  });
  useEscape(!!route, () => setRoute(null), ESC.drag);
  useEscape(area.length > 0, () => setArea([]), ESC.drag);
  useEscape(!!going, () => setGoing(null), ESC.overlay);
  useEscape(!!ask, () => setAsk(null), ESC.overlay);
  useEscape(tool !== "select", () => eui.set({ pcbTool: "select" }), ESC.tool);
  useEscape(tool === "select" && ui.selected.length > 0, () => eui.set({ selected: [], net: null }), ESC.selection);

  const onDown = (p: Pointer): boolean => {
    // The tools work by clicks, so a drag is free to pan on a touch screen.
    if (tool !== "select") return false;
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
    if (!readOnly && ids.includes(hit.id)) drag.current = { ids, last: snap(p.world, grid), key: `ec-board-move-${(run += 1)}` };
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
        edit((x) => moveOnBoard(x, d.ids, dx, dy), "Move", d.key);
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
      setRoute({ net: from.net, last: from.at, diag: false });
    } else if (tool === "via") {
      const on = copperAt(p.world);
      const to = on?.at ?? snap(p.world, grid);
      const net = on?.net ?? "";
      const stop = inWay(net, ["top", "bottom"], [to], netRules(board, net).viaDiameter);
      if (stop) return tooClose(stop.what);
      setSaid("");
      edit((d) => addVia(d, net, to[0], to[1]), "Add a via");
    } else if (tool === "hole") {
      const to = snap(p.world, grid);
      edit((d) => addHole(d, to[0], to[1], 3.2), "Add a hole");
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
      if (moved) eui.set({ selected: boxBoard(design, box[0], p.world), net: null });
      else if (!p.shift) eui.set({ selected: [], net: null, spot: null });
      setBox(null);
    }
    drag.current = null;
  };

  // The piece of track that would go down on the next click.
  const ghost = useMemo(() => {
    if (!route || !at || !board) return undefined;
    const { pts, stop } = way(route, aim(at, route).to);
    return { track: { pts, width: widthOf(route.net), layer, blocked: !!stop } };
  }, [route, at, board, copper, layer, width, ui.keepClear, grid]); // eslint-disable-line react-hooks/exhaustive-deps
  const clashes = useMemo(
    () => (findClashes && tool === "select" && selected.size ? findClashes(design, selected) : []),
    [findClashes, tool, selected, design.board, design.parts], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const clashing = useMemo(() => new Set(clashes.flatMap((c) => c.parts)), [clashes]);
  const marks = useMemo(() => (ui.spot?.sheet === "board" ? [{ at: ui.spot.at }] : undefined), [ui.spot]);

  const drawing = useMemo(() => (area.length ? (at ? [...area, snap(at, grid)] : [...area, area[area.length - 1]!]) : undefined), [area, at, grid]);
  const asking = going?.every((id) => selected.has(id)) ? going : null;
  const goingNames = asking?.map((id) => design.parts.find((p) => p.id === id)?.ref ?? "").filter(Boolean) ?? [];

  const left = air.length;
  const hint =
    tool === "route"
      ? route
        ? `Routing ${route.net} on the ${layer} side. Click to turn, click a pad to finish.`
        : "Click a pad to start a track."
      : tool === "via"
        ? "Click a track or a pad to drop a via on it."
        : tool === "hole"
          ? "Click where the mounting hole goes."
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
        drawKey={[design, selected, hover, hidden, ui.layer, ui.net, box, colours, ghost, marks, air, pours, drawing, clashing]}
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
