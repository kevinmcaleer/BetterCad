import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { DrawingNote } from "@bettercad/kernel/drawing";
import type { V2 } from "@bettercad/kernel/view";
import { noteArt, noteName, NOTE_TEXT, type NoteContext } from "./notes";
import { curvePath } from "./views";

/** How far an arrow key moves a note, mm on paper. */
const NUDGE = 1;
const n = (v: number) => String(Math.round(v * 1000) / 1000);

export interface NoteLayerProps {
  /** The notes of one view, or the loose ones of the sheet. */
  notes: DrawingNote[];
  /** The view they point into; left out for loose text. */
  ctx?: NoteContext;
  /** Screen pixels per paper millimetre, to turn a drag into millimetres. */
  zoom: number;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** A note moved, by a drag or the arrow keys. Left out, notes are only drawn. */
  onMove?: (id: string, at: V2) => void;
  onDelete?: (id: string) => void;
  /** Enter or a double-click: change what it says. */
  onEdit?: (id: string) => void;
}

/**
 * Notes (#573), inside their view's group or the sheet's: paper millimetres with y down as SVG draws. Each is a
 * button named for what it says; drag it by its text, nudge it with the arrow keys, Enter changes it, Delete removes it.
 */
export function NoteLayer({ notes, ctx, zoom, selected, onSelect, onMove, onDelete, onEdit }: NoteLayerProps) {
  const [drag, setDrag] = useState<{ id: string; at: V2 } | null>(null);
  const press = useRef<{ note: DrawingNote; x: number; y: number; moved: boolean } | null>(null);
  const down = (e: PointerEvent<SVGGElement>, note: DrawingNote) => {
    // A press on a note is its own: the view or sheet under it must not start to move.
    e.stopPropagation();
    if (!onMove || e.button !== 0) return;
    press.current = { note, x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent<SVGGElement>) => {
    const p = press.current;
    if (!p) return;
    const [dx, dy] = [e.clientX - p.x, e.clientY - p.y];
    if (!p.moved && Math.hypot(dx, dy) < 3) return;
    p.moved = true;
    setDrag({ id: p.note.id, at: [p.note.at[0] + dx / zoom, p.note.at[1] - dy / zoom] });
  };
  const up = (e: PointerEvent<SVGGElement>) => {
    const p = press.current;
    press.current = null;
    e.stopPropagation();
    if (p?.moved && drag && e.type !== "pointercancel") onMove?.(drag.id, [Math.round(drag.at[0] * 100) / 100, Math.round(drag.at[1] * 100) / 100]);
    setDrag(null);
  };
  const key = (e: KeyboardEvent, note: DrawingNote) => {
    // The keys a view under the note also answers to are the note's own; the rest (D, F, Esc) go on to the tools.
    if (!/^(Arrow|Delete$|Backspace$|Enter$)/.test(e.key)) return;
    e.stopPropagation();
    const step = e.shiftKey ? NUDGE * 10 : NUDGE;
    const by: Record<string, V2> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const go = by[e.key];
    if (go && onMove) onMove(note.id, [note.at[0] + go[0], note.at[1] + go[1]]);
    else if (onDelete && (e.key === "Delete" || e.key === "Backspace")) onDelete(note.id);
    else if (onEdit && e.key === "Enter" && note.kind !== "hole") onEdit(note.id);
    else return;
    e.preventDefault();
  };
  return (
    <>
      {notes.map((note) => {
        const art = noteArt(drag?.id === note.id ? { ...note, at: drag.at } : note, ctx);
        if (!art) return null;
        const d =
          art.lines.map(([a, b]) => `M${n(a[0])} ${n(-a[1])}L${n(b[0])} ${n(-b[1])}`).join("") + art.curves.map((c) => curvePath(c, 1, [0, 0])).join("");
        const { min, max } = art.box;
        return (
          <g
            key={note.id}
            data-note={note.id}
            className={selected === note.id ? "bc-note-on bc-sheet-note" : "bc-sheet-note"}
            role="button"
            aria-label={noteName(note, art)}
            aria-pressed={selected === note.id}
            tabIndex={0}
            onFocus={() => onSelect?.(note.id)}
            onPointerDown={(e) => down(e, note)}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (note.kind !== "hole") onEdit?.(note.id);
            }}
            onKeyDown={(e) => key(e, note)}
          >
            <rect className="bc-sheet-note-grip" x={n(min[0])} y={n(-max[1])} width={n(max[0] - min[0])} height={n(max[1] - min[1])} />
            {d && <path className="bc-sheet-note-line" d={d} />}
            {art.fills.map((f, i) => (
              <polygon key={i} className="bc-sheet-note-fill" points={f.map((p) => `${n(p[0])},${n(-p[1])}`).join(" ")} />
            ))}
            {art.texts.map((t, i) => (
              <text key={i} className="bc-sheet-note-text" x={n(t.at[0])} y={n(-t.at[1])} fontSize={NOTE_TEXT} textAnchor={t.anchor} dominantBaseline="central">
                {t.text}
              </text>
            ))}
          </g>
        );
      })}
    </>
  );
}
