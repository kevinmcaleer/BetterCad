import { useEffect, useMemo, useRef, useState } from "react";
import {
  GRID,
  addJunction,
  addLabel,
  addNote,
  addNoConnect,
  addWires,
  clipOrigin,
  copyFromSheet,
  emptyBox,
  grow,
  key,
  flipOnSheet,
  mirrorOnSheet,
  moveOnSheet,
  netAt,
  netlist,
  onSegment,
  pasteOnSheet,
  placePart,
  placedPins,
  removeFromSheet,
  renameLabel,
  setNoteText,
  renumber,
  rotateOnSheet,
  type Box,
  type ElectronicsDesign,
  type P2,
  type Rot,
  type Shape,
  type Sheet,
} from "@bettercad/electronics";
import { groupOf, groupOnSheet, groupsIn, renameGroup, ungroupOnSheet, unitOf, wholeGroups } from "@bettercad/electronics/groups";
import { ESC, useEscape } from "@bettercad/ui";
import { eactions, type EEdit } from "./actions";
import { Canvas2D, type Canvas2DApi, type Pointer } from "./Canvas2D";
import { getClip, setClip } from "./clip";
import { readColours } from "./colours";
import { drawSchematic } from "./drawSchematic";
import { staleBlocks } from "./blockVersions";
import { boxSheet, groupOutlines, hitGroupOutline, hitSheet, noteBox, placedBox } from "./hit";
import { eui } from "./ui";
import { useEui } from "./useEui";
import { fit, snap, toScreen, type View2D } from "./view2d";

/** Cameras outlive a switch to the other view and back, per sheet. */
const cameras = new Map<string, View2D>();
let run = 0;

/** The insets the floating cards take, from the shell's `--bc-view-*` values. */
export function clearOf(host: Element | null): { top: number; right: number; bottom: number; left: number } {
  // A hidden box laid out with the same insets as the cards (they are calc() values, so CSS has to work them out).
  const clear = host?.querySelector(".bc-ec-clear")?.getBoundingClientRect();
  const all = host?.getBoundingClientRect();
  if (!clear || !all || !clear.width) return { top: 56, right: 0, bottom: 64, left: 0 };
  return { top: clear.top - all.top, right: all.right - clear.right, bottom: all.bottom - clear.bottom, left: clear.left - all.left };
}

/** Everything on a sheet, boxed, for Fit. An empty sheet shows a patch round the origin. */
export function sheetBox(d: ElectronicsDesign, sheet: Sheet, only?: Set<string>): Box {
  const b = emptyBox();
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  for (const s of sheet.symbols) {
    if (only && !only.has(s.id)) continue;
    const def = d.defs[parts.get(s.part)?.def ?? ""];
    if (!def) continue;
    const sb = placedBox(def.symbol, s);
    grow(grow(b, [sb.x1, sb.y1], 2), [sb.x2, sb.y2], 2);
  }
  for (const w of sheet.wires) if (!only || only.has(w.id)) grow(grow(b, w.a), w.b);
  for (const l of sheet.labels) if (!only || only.has(l.id)) grow(b, [l.x, l.y], 2);
  for (const o of groupOutlines(d, sheet))
    if (!only || sheet.groups?.find((g) => g.id === o.id)?.members.some((m) => only.has(m))) grow(grow(b, [o.box.x1, o.box.y1]), [o.box.x2, o.box.y2 + 2]);
  for (const n of sheet.notes ?? [])
    if (!only || only.has(n.id)) {
      const nb = noteBox(n);
      grow(grow(b, [nb.x1, nb.y1], 1), [nb.x2, nb.y2], 1);
    }
  if (b.x1 === Infinity) return { x1: -28, y1: -20, x2: 28, y2: 20 };
  return b;
}

/** A field over the sheet: a net label's name, a text note's words (#733), or with `group` set a group's name (#766). `id` edits one that is there. */
export interface LabelAsk {
  at: P2;
  screen: P2;
  id?: string;
  name?: string;
  note?: boolean;
  group?: boolean;
}

/** The note a line, box or circle tool makes from its first click to its second (#733). Null when it would be nothing. */
export function noteShape(tool: "line" | "rect" | "circle", a: P2, b: P2): Shape | null {
  if (a[0] === b[0] && a[1] === b[1]) return null;
  if (tool === "line") return { kind: "line", pts: [a, b] };
  if (tool === "rect") {
    if (a[0] === b[0] || a[1] === b[1]) return null;
    return { kind: "rect", x1: Math.min(a[0], b[0]), y1: Math.min(a[1], b[1]), x2: Math.max(a[0], b[0]), y2: Math.max(a[1], b[1]), fill: false };
  }
  return { kind: "circle", cx: a[0], cy: a[1], r: Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * 1e4) / 1e4 };
}

export interface SchematicCanvasProps {
  design: ElectronicsDesign;
  sheet: Sheet;
  edit: EEdit;
  readOnly?: boolean;
  /** A label, note or group being named: where it goes on the screen, for the little field the view shows over the canvas. */
  onAskLabel: (ask: LabelAsk | null) => void;
}

/** The schematic (#617, #631, #632): place parts, wire them, name the nets. */
export function SchematicCanvas({ design, sheet, edit, readOnly, onAskLabel }: SchematicCanvasProps) {
  const ui = useEui();
  const api = useRef<Canvas2DApi>(null);
  const host = useRef<HTMLDivElement>(null);
  const [view, setViewState] = useState<View2D>(() => cameras.get(sheet.id) ?? { scale: 6, ox: 400, oy: 300 });
  const [, setSized] = useState(0);
  const fitted = useRef(cameras.has(sheet.id));
  const setView = (v: View2D) => {
    cameras.set(sheet.id, v);
    setViewState(v);
  };
  const [hover, setHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState<P2 | null>(null);
  const [box, setBox] = useState<[P2, P2] | null>(null);
  /** The wire being drawn: the corner it continues from. */
  const [from, setFrom] = useState<P2 | null>(null);
  /** The first click of a line, box or circle note. */
  const [noteFrom, setNoteFrom] = useState<P2 | null>(null);
  useEffect(() => setNoteFrom(null), [ui.schTool]);
  const [turnBy, setTurnBy] = useState<Rot>(0);
  const [flipped, setFlipped] = useState(false);
  const drag = useRef<{ ids: string[]; start: P2; last: P2; key: string } | null>(null);

  const nl = useMemo(() => netlist(design), [design]);
  const pins = useMemo(() => placedPins(design).filter((p) => p.sheet === sheet.id), [design, sheet.id]);
  const selected = useMemo(() => new Set(ui.selected), [ui.selected]);
  const outlines = useMemo(() => groupOutlines(design, sheet), [design, sheet]);
  const stale = useMemo(() => staleBlocks(design, sheet), [design, sheet]);
  const inside = ui.inGroup && sheet.groups?.some((g) => g.id === ui.inGroup) ? ui.inGroup : null;
  const picked = useMemo(() => new Set(groupsIn(sheet, ui.selected).map((g) => g.id)), [sheet, ui.selected]);
  const askGroupName = (d: ElectronicsDesign, id: string) => {
    const o = groupOutlines(d, d.sheets.find((x) => x.id === sheet.id) ?? sheet).find((x) => x.id === id);
    const g = d.sheets.find((x) => x.id === sheet.id)?.groups?.find((x) => x.id === id);
    if (o && g) onAskLabel({ at: [o.box.x1, o.box.y2], screen: toScreen(view, [o.box.x1, o.box.y2]), id, name: g.name, group: true });
  };
  const colours = useMemo(() => readColours(host.current), [host.current, ui.view]); // eslint-disable-line react-hooks/exhaustive-deps
  const tool = readOnly ? "select" : ui.schTool;

  const doFit = (only?: Set<string>) => {
    const size = api.current?.size();
    if (!size || size.w < 10) return false;
    const v = fit(sheetBox(design, sheet, only), size, clearOf(host.current));
    setView(only ? { ...v, scale: Math.min(v.scale, 12) } : { ...v, scale: Math.min(v.scale, 14) });
    return true;
  };
  useEffect(() => {
    if (!fitted.current) fitted.current = doFit();
  });
  // Coming from the other view with something picked: bring it into the middle.
  const focus = useRef(ui.focus);
  useEffect(() => {
    if (ui.focus !== focus.current) {
      focus.current = ui.focus;
      if (ui.selected.length) doFit(new Set(ui.selected));
    }
  });

  /** A point wires join at, within reach: a pin end, a wire end, or somewhere along a wire. */
  const joinAt = (p: P2): boolean => pins.some((x) => key(x.at[0], x.at[1]) === key(p[0], p[1])) || sheet.wires.some((w) => onSegment(p, w.a, w.b));
  const snapped = (p: Pointer): P2 => {
    // Pins of imported parts are not always on the grid: a pin end close by wins over the grid.
    const reach = Math.max(GRID / 2, 10 / view.scale);
    let best: P2 | null = null;
    let bd = reach;
    for (const pin of pins) {
      const dd = Math.hypot(pin.at[0] - p.world[0], pin.at[1] - p.world[1]);
      if (dd < bd) [best, bd] = [pin.at, dd];
    }
    return best ?? snap(p.world, GRID);
  };

  const remove = () => {
    if (readOnly || !ui.selected.length) return;
    edit((d) => removeFromSheet(d, sheet.id, ui.selected), ui.selected.length === 1 ? "Delete" : `Delete ${ui.selected.length} things`);
    eui.set({ selected: [] });
  };
  const paste = (beside: boolean) => {
    const clip = beside ? copyFromSheet(design, sheet.id, eui.get().selected) : getClip();
    if (readOnly || !clip) return;
    // Under the pointer when it is over the sheet; else, and for a duplicate, two grid steps down and right.
    const from = clipOrigin(clip);
    const [dx, dy] = !beside && cursor ? [cursor[0] - from[0], cursor[1] - from[1]] : [2 * GRID, -2 * GRID];
    eui.set({ schTool: "select", placing: null, placingBlock: null });
    edit(
      (d) => {
        const pasted = pasteOnSheet(d, sheet.id, clip, dx, dy);
        // The edit lands a moment later; the copy is picked once it is there, ready to drag into place.
        queueMicrotask(() => eui.set({ selected: pasted.ids }));
        return pasted.design;
      },
      beside ? "Duplicate" : "Paste",
    );
  };
  // A check's result was clicked: bring its spot into the middle.
  const spotted = useRef(0);
  useEffect(() => {
    const spot = ui.spot;
    const size = api.current?.size();
    if (!spot || spot.sheet !== sheet.id || spot.n === spotted.current || !size) return;
    spotted.current = spot.n;
    const clear = clearOf(host.current);
    const scale = Math.max(view.scale, 8);
    // On a wide screen the card sits on the left of the view, so the spot goes a little right of the middle.
    const across = clear.left + (size.w - clear.right - clear.left) * (size.w > 900 ? 0.62 : 0.5);
    setView({ scale, ox: across - spot.at[0] * scale, oy: (clear.top + size.h - clear.bottom) / 2 + spot.at[1] * scale });
  });
  useEffect(() => {
    eactions.current = {
      copy: () => {
        const clip = copyFromSheet(design, sheet.id, eui.get().selected);
        if (clip) setClip(clip);
      },
      paste: () => paste(false),
      duplicate: () => paste(true),
      renumber: () => !readOnly && edit(renumber, "Renumber"),
      fit: () => doFit(),
      rotate: () => {
        if (eui.get().placing) return setTurnBy((r) => ((r + 90) % 360) as Rot);
        if (!readOnly && eui.get().selected.length) edit((d) => rotateOnSheet(d, sheet.id, eui.get().selected), "Rotate");
      },
      mirror: () => {
        if (eui.get().placing) return setFlipped((f) => !f);
        if (!readOnly && eui.get().selected.length) edit((d) => mirrorOnSheet(d, sheet.id, eui.get().selected), "Mirror");
      },
      flip: () => {
        if (eui.get().placing) {
          setFlipped((f) => !f);
          return setTurnBy((r) => ((r + 180) % 360) as Rot);
        }
        if (!readOnly && eui.get().selected.length) edit((d) => flipOnSheet(d, sheet.id, eui.get().selected), "Flip");
      },
      remove,
      push: () => eui.set({ card: "changes" }),
      group: () => {
        const ids = eui.get().selected;
        if (readOnly || !ids.length) return;
        const made = groupOnSheet(design, sheet.id, ids);
        if (!made.id) return;
        edit((d) => (d === design ? made.design : groupOnSheet(d, sheet.id, ids).design), "Group");
        eui.set({ inGroup: null });
        askGroupName(made.design, made.id);
      },
      ungroup: () => {
        const gone = groupsIn(sheet, eui.get().selected);
        if (readOnly || !gone.length) return;
        edit((d) => gone.reduce((x, g) => ungroupOnSheet(x, sheet.id, g.id), d), gone.length === 1 ? "Ungroup" : `Ungroup ${gone.length} groups`);
        eui.set({ inGroup: null });
      },
      groupToggle: () => {
        const ids = eui.get().selected;
        const whole = groupsIn(sheet, ids);
        const covered = new Set(whole.flatMap((g) => g.members));
        if (whole.length && ids.every((id) => covered.has(id))) eactions.current?.ungroup?.();
        else eactions.current?.group?.();
      },
      selectAll: () =>
        eui.set({
          selected: [
            ...sheet.symbols.map((s) => s.id),
            ...sheet.wires.map((w) => w.id),
            ...sheet.labels.map((l) => l.id),
            ...(sheet.notes ?? []).map((n) => n.id),
          ],
        }),
    };
    return () => {
      eactions.current = null;
    };
  });

  // Esc backs out one layer: the wire corner, then the tool, then the selection.
  useEscape(tool === "wire" && !!from, () => setFrom(null), ESC.drag);
  useEscape(!!noteFrom, () => setNoteFrom(null), ESC.drag);
  useEscape(tool !== "select", () => eui.set({ schTool: "select", placing: null, placingBlock: null }), ESC.tool);
  useEscape(tool === "select" && ui.selected.length > 0, () => eui.set({ selected: [] }), ESC.selection);
  useEscape(tool === "select" && !!inside && !ui.selected.length, () => eui.set({ inGroup: null }), ESC.selection);

  const tol = 6 / view.scale;
  const elbow = (a: P2, b: P2): P2[] => (a[0] === b[0] || a[1] === b[1] ? [a, b] : [a, [b[0], a[1]], b]);

  const onDown = (p: Pointer): boolean => {
    if (tool !== "select") return true;
    const hit = hitSheet(design, sheet, p.world, tol)[0];
    // A group's edge or name picks the whole group, ready to drag as one block (#766).
    const edge = hit ? undefined : hitGroupOutline(outlines, p.world, tol);
    const grabbed = hit?.id ?? sheet.groups?.find((g) => g.id === edge?.id)?.members[0];
    if (!grabbed) {
      if (p.touch) return false;
      setBox([p.world, p.world]);
      return true;
    }
    // Clicking outside the group gone into comes back out of it.
    const into = edge ? null : groupOf(sheet, grabbed)?.id === inside ? inside : null;
    const unit = wholeGroups(sheet, [grabbed], into);
    let ids = ui.selected;
    if (p.shift) ids = unit.every((x) => ids.includes(x)) ? ids.filter((x) => !unit.includes(x)) : [...new Set([...ids, ...unit])];
    else if (!ids.includes(grabbed)) ids = unit;
    eui.set({ selected: ids, inGroup: into });
    if (!readOnly && ids.includes(grabbed)) {
      const s = snap(p.world, GRID);
      drag.current = { ids, start: s, last: s, key: `ec-move-${(run += 1)}` };
    }
    return true;
  };

  const onMove = (p: Pointer, dragging: boolean) => {
    const at = snapped(p);
    setCursor(at);
    if (tool === "select") {
      if (box && dragging) return setBox([box[0], p.world]);
      const d = drag.current;
      if (d && dragging) {
        const s = snap(p.world, GRID);
        const dx = s[0] - d.last[0];
        const dy = s[1] - d.last[1];
        if (dx || dy) {
          d.last = s;
          edit((x) => moveOnSheet(x, sheet.id, d.ids, dx, dy), "Move", d.key);
        }
        return;
      }
      if (!p.touch) {
        const over = hitSheet(design, sheet, p.world, tol)[0]?.id ?? null;
        setHover(over ?? (hitGroupOutline(outlines, p.world, tol) ? "group" : null));
      }
    }
  };

  const onUp = (p: Pointer, moved: boolean) => {
    const at = snapped(p);
    if (tool === "select") {
      if (box) {
        if (moved) eui.set({ selected: wholeGroups(sheet, boxSheet(design, sheet, box[0], p.world), inside) });
        else if (!p.shift) eui.set({ selected: [], inGroup: null });
        setBox(null);
      } else if (!moved && !drag.current && !hitSheet(design, sheet, p.world, tol)[0] && !p.shift) eui.set({ selected: [] });
      drag.current = null;
      return;
    }
    if (tool === "place" && ui.placingBlock) {
      const { built, place } = ui.placingBlock;
      edit((d) => {
        const placed = place(d, sheet.id, at);
        // Picked once it lands, so it can be dragged straight into place; placing stops after one.
        queueMicrotask(() => eui.set({ selected: placed.ids, schTool: "select", placingBlock: null }));
        return placed.design;
      }, `Place ${built.spec.name}`);
      return;
    }
    if (tool === "place") {
      const def = ui.placing;
      if (!def) return;
      edit((d) => placePart(d, sheet.id, def, { x: at[0], y: at[1], rot: turnBy, mirror: flipped }, { pkg: ui.placingPkg }).design, `Place ${def.name}`);
      return;
    }
    if (tool === "wire") {
      if (!from) return setFrom(at);
      if (key(from[0], from[1]) === key(at[0], at[1])) return setFrom(null);
      const pts = elbow(from, at);
      edit((d) => addWires(d, sheet.id, pts), "Wire");
      // Landing on a pin or a wire finishes the run; anywhere else is a corner to carry on from.
      setFrom(joinAt(at) ? null : at);
      return;
    }
    if (tool === "label") return onAskLabel({ at, screen: toScreen(view, at) });
    if (tool === "text") return onAskLabel({ at, screen: toScreen(view, at), note: true });
    if (tool === "line" || tool === "rect" || tool === "circle") {
      const pt = snap(p.world, GRID);
      if (!noteFrom) return setNoteFrom(pt);
      const made = noteShape(tool, noteFrom, pt);
      setNoteFrom(null);
      if (made) edit((d) => addNote(d, sheet.id, made).design, tool === "line" ? "Draw a line" : tool === "rect" ? "Draw a box" : "Draw a circle");
      return;
    }
    if (tool === "noConnect") return edit((d) => addNoConnect(d, sheet.id, at[0], at[1]), "Mark not connected");
    if (tool === "junction") return edit((d) => addJunction(d, sheet.id, at[0], at[1]), "Junction");
  };

  const ghost = useMemo(() => {
    if (!cursor) return undefined;
    if (tool === "place" && ui.placingBlock) {
      const c = ui.placingBlock.built.clip;
      const defOf = new Map(c.parts.map((p) => [p.id, c.defs[p.def]!]));
      return {
        symbols: c.symbols.map((s) => ({ def: unitOf(defOf.get(s.part)!.symbol, s.unit), at: { x: s.x + cursor[0], y: s.y + cursor[1], rot: s.rot } })),
        wires: c.wires.map((w): [P2, P2] => [
          [w.a[0] + cursor[0], w.a[1] + cursor[1]],
          [w.b[0] + cursor[0], w.b[1] + cursor[1]],
        ]),
      };
    }
    if (tool === "place" && ui.placing)
      return { symbols: [{ def: ui.placing.symbol, at: { x: cursor[0], y: cursor[1], rot: turnBy, mirror: flipped }, value: ui.placing.value }] };
    if (tool === "wire" && from) {
      const pts = elbow(from, cursor);
      return { wires: pts.slice(1).map((b, i) => [pts[i]!, b] as [P2, P2]) };
    }
    if ((tool === "line" || tool === "rect" || tool === "circle") && noteFrom) {
      const made = noteShape(tool, noteFrom, cursor);
      return made ? { notes: [made] } : undefined;
    }
    return undefined;
  }, [cursor, tool, ui.placing, ui.placingBlock, from, turnBy, flipped, noteFrom]);

  /** Hovering a wire or a label lights its whole net across the sheet. */
  const lit = useMemo(() => {
    const over = sheet.wires.find((w) => w.id === hover)?.a ?? sheet.labels.filter((l) => l.id === hover).map((l): P2 => [l.x, l.y])[0];
    const net = over && netAt(nl, sheet.id, over);
    if (!net) return undefined;
    return { net, ids: new Set(sheet.wires.filter((w) => netAt(nl, sheet.id, w.a) === net).map((w) => w.id)) };
  }, [hover, nl, sheet]);
  useEffect(() => {
    if ((lit?.net ?? null) !== eui.get().net) eui.set({ net: lit?.net ?? null });
  }, [lit]);

  const marks = useMemo(
    () => [
      ...nl.floating.filter((p) => p.sheet === sheet.id).map((p) => p.at),
      ...nl.nets.flatMap((n) => n.openEnds.filter((e) => e.sheet === sheet.id).map((e) => e.at)),
    ],
    [nl, sheet.id],
  );

  return (
    <div ref={host} className="bc-ec-host">
      <div className="bc-ec-clear" aria-hidden="true" />
      <Canvas2D
        onResize={() => !fitted.current && setSized((n) => n + 1)}
        api={api}
        label={`Schematic, ${sheet.name}: ${design.parts.length} ${design.parts.length === 1 ? "part" : "parts"}, ${nl.nets.length} ${nl.nets.length === 1 ? "net" : "nets"}`}
        view={view}
        onView={setView}
        cursor={tool === "select" ? (hover ? "move" : "default") : "crosshair"}
        drawKey={[design, sheet, selected, hover, ghost, box, colours, marks, lit, ui.spot, outlines, picked, inside, stale]}
        draw={(ctx, v, size) =>
          drawSchematic(ctx, v, size, design, sheet, colours, {
            selected,
            hover,
            ghost,
            box,
            marks,
            lit: lit?.ids,
            spot: ui.spot?.sheet === sheet.id ? ui.spot.at : undefined,
            groups: { outlines, picked, inside, stale },
          })
        }
        onDown={onDown}
        onMove={onMove}
        onUp={onUp}
        onDouble={(p) => {
          if (readOnly) return;
          if (tool === "wire") return setFrom(null);
          const hit = hitSheet(design, sheet, p.world, tol)[0];
          const edge = hit ? undefined : hitGroupOutline(outlines, p.world, tol);
          if (edge) return askGroupName(design, edge.id);
          // Double-click a thing in a group: go into the group and pick just that thing.
          const g = hit && groupOf(sheet, hit.id);
          if (g && g.id !== inside) return eui.set({ inGroup: g.id, selected: [hit.id] });
          const label = hit?.kind === "label" ? sheet.labels.find((l) => l.id === hit.id) : undefined;
          if (label) onAskLabel({ at: [label.x, label.y], screen: toScreen(view, [label.x, label.y]), id: label.id, name: label.name });
          const note = hit?.kind === "note" ? sheet.notes?.find((n) => n.id === hit.id) : undefined;
          if (note?.kind === "text") onAskLabel({ at: [note.x, note.y], screen: toScreen(view, [note.x, note.y]), id: note.id, name: note.text, note: true });
        }}
      />
    </div>
  );
}

/** Applies the name field: a new label, or a new name for a label or a group; or a text note's words (#733). */
export function commitLabel(edit: EEdit, sheet: string, ask: { at: P2; id?: string; note?: boolean; group?: boolean }, name: string): void {
  const text = name.trim();
  if (ask.note) {
    if (ask.id) edit((d) => setNoteText(d, sheet, ask.id!, text), text ? "Change a note" : "Delete a note");
    else if (text) edit((d) => addNote(d, sheet, { kind: "text", x: ask.at[0], y: ask.at[1], text, size: 1.27, align: "left" }).design, "Add a note");
    return;
  }
  if (!text) return;
  if (ask.group && ask.id) return edit((d) => renameGroup(d, sheet, ask.id!, text), "Rename group");
  if (ask.id) edit((d) => renameLabel(d, sheet, ask.id!, text), "Rename label");
  else edit((d) => addLabel(d, sheet, text, ask.at[0], ask.at[1]), "Label");
}
