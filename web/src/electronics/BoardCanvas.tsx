import { useEffect, useMemo, useRef, useState } from "react";
import {
  boardPads,
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
import { ESC, useEscape } from "@bettercad/ui";
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
/** The grid parts and tracks snap to on the board, mm. */
export const BOARD_GRID = 0.5;

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
  if (b.x1 === Infinity) return boardBox(d);
  return b;
}

export interface BoardCanvasProps {
  design: ElectronicsDesign;
  edit: EEdit;
  readOnly?: boolean;
}

/** The PCB (#617): the board, its parts, copper and the lines still to route. Select, move, turn and flip parts. */
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
  const [box, setBox] = useState<[P2, P2] | null>(null);
  const drag = useRef<{ ids: string[]; last: P2; key: string } | null>(null);

  const nl = useMemo(() => netlist(design), [design]);
  const pads = useMemo(() => boardPads(design, nl), [design, nl]);
  const air = useMemo(() => ratsnest(pads), [pads]);
  const selected = useMemo(() => new Set(ui.selected), [ui.selected]);
  const hidden = useMemo(() => new Set<LayerId>(ui.hidden), [ui.hidden]);
  const colours = useMemo(() => readColours(host.current), [host.current, ui.view]); // eslint-disable-line react-hooks/exhaustive-deps

  const doFit = (only?: Set<string>) => {
    const size = api.current?.size();
    if (!size || size.w < 10) return false;
    const v = fit(boardBox(design, only), size, clearOf(host.current));
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
        if (rest.length) edit((d) => removeFromBoard(d, rest), "Delete");
        eui.set({ selected: picked().filter((id) => parts.has(id)) });
      },
      push: () => eui.set({ card: "changes" }),
      selectAll: () => eui.set({ selected: design.board?.placements.map((p) => p.part) ?? [] }),
    };
    return () => {
      eactions.current = null;
    };
  });
  useEscape(ui.selected.length > 0, () => eui.set({ selected: [], net: null }), ESC.selection);

  const tol = 5 / view.scale;
  const shown = (l: "top" | "bottom") => !hidden.has(l);
  /** A part wins over its own pads, so a click on a pad picks the part; copper and holes win over parts. */
  const hitAt = (p: P2) => {
    const hits = hitBoard(design, pads, p, tol, shown);
    return hits.find((h) => h.kind !== "pad" && h.kind !== "part") ?? hits.find((h) => h.kind === "part") ?? hits.find((h) => h.kind === "pad");
  };

  const onDown = (p: Pointer): boolean => {
    const hit = hitAt(p.world);
    if (!hit) {
      if (p.touch) return false;
      setBox([p.world, p.world]);
      return true;
    }
    let ids = ui.selected;
    if (p.shift) ids = ids.includes(hit.id) ? ids.filter((x) => x !== hit.id) : [...ids, hit.id];
    else if (!ids.includes(hit.id)) ids = [hit.id];
    eui.set({ selected: ids, net: hit.net || null });
    if (!readOnly && ids.includes(hit.id)) drag.current = { ids, last: snap(p.world, BOARD_GRID), key: `ec-board-move-${(run += 1)}` };
    return true;
  };

  const onMove = (p: Pointer, dragging: boolean) => {
    if (box && dragging) return setBox([box[0], p.world]);
    const d = drag.current;
    if (d && dragging) {
      const s = snap(p.world, BOARD_GRID);
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

  const onUp = (p: Pointer, moved: boolean) => {
    if (box) {
      if (moved) eui.set({ selected: boxBoard(design, box[0], p.world), net: null });
      else if (!p.shift) eui.set({ selected: [], net: null });
      setBox(null);
    }
    drag.current = null;
  };

  const left = air.length;
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
        cursor={hover ? "move" : "default"}
        drawKey={[design, selected, hover, hidden, ui.layer, ui.net, box, colours]}
        draw={(ctx, v, size) => drawBoard(ctx, v, size, design, colours, { selected, hover, hidden, active: ui.layer, net: ui.net, pads, air, box })}
        onDown={onDown}
        onMove={onMove}
        onUp={onUp}
      />
    </div>
  );
}
