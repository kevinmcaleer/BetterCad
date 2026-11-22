import type { KeyboardEvent } from "react";
import type { TitleBlock } from "@bettercad/kernel/drawing";
import { TEXT, type SheetLayout, type TitleCell } from "./layout";

const line = (s: { x1: number; y1: number; x2: number; y2: number }, i: number) => <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />;

/**
 * The projection symbol: a cone seen from the side and from its small end. First angle (ISO) puts the end view on the
 * right, third angle (ASME) on the left, which is how each standard lays its views out.
 */
function Projection({ cell, angle }: { cell: TitleCell; angle: "first" | "third" }) {
  const cy = cell.y + cell.h / 2 + 1.2;
  const cx = cell.x + cell.w / 2;
  // 6 long, 5 tall at the big end and 2.6 at the small; the circles are the same two ends.
  const cone = angle === "first" ? cx - 6.4 : cx + 0.4;
  const rings = angle === "first" ? cx + 3.9 : cx - 3.9;
  return (
    <g className="bc-sheet-thin" aria-hidden="true">
      <path d={`M${cone} ${cy - 1.3}L${cone + 6} ${cy - 2.5}V${cy + 2.5}L${cone} ${cy + 1.3}Z`} />
      <circle cx={rings} cy={cy} r={2.5} />
      <circle cx={rings} cy={cy} r={1.3} />
    </g>
  );
}

export interface SheetArtProps {
  layout: SheetLayout;
  /** Opens a title block field for typing. Left out, the block is only drawn (a read-only model, an export). */
  onEdit?: (field: keyof TitleBlock) => void;
  /** The field being typed in: its drawn value steps aside for the box over it. */
  editing?: keyof TitleBlock | null;
}

/** Everything printed round a drawing, in page millimetres: the paper, frame, zones, centring marks and title block. */
export function SheetArt({ layout: l, onEdit, editing }: SheetArtProps) {
  const f = l.frame;
  return (
    <g className="bc-sheet">
      <rect className="bc-sheet-paper" width={l.page.w} height={l.page.h} />
      {l.border && (
        <>
          <rect className="bc-sheet-thick" x={f.x} y={f.y} width={f.w} height={f.h} />
          <g className="bc-sheet-thin" aria-hidden="true">
            {l.ticks.map(line)}
          </g>
          <g className="bc-sheet-thick" aria-hidden="true">
            {l.centring.map(line)}
          </g>
          <g className="bc-sheet-text" aria-hidden="true" fontSize={TEXT.zone}>
            {l.labels.map((z, i) => (
              <text key={i} x={z.x} y={z.y} textAnchor="middle" dominantBaseline="central">
                {z.text}
              </text>
            ))}
          </g>
        </>
      )}
      <g role="group" aria-label="Title block">
        <rect className="bc-sheet-thick bc-sheet-block" x={l.block.x} y={l.block.y} width={l.block.w} height={l.block.h} />
        {l.cells.map((c) => {
          const edit = onEdit && c.edit;
          const said = c.key === "projection" ? (l.angle === "first" ? "first angle" : "third angle") : c.value || "blank";
          const open = edit ? () => onEdit(edit) : undefined;
          return (
            <g
              key={c.key}
              className={edit ? "bc-sheet-cell bc-sheet-field" : "bc-sheet-cell"}
              role={edit ? "button" : "img"}
              aria-label={`${c.label}: ${said}`}
              tabIndex={edit ? 0 : undefined}
              onDoubleClick={open}
              onKeyDown={
                open &&
                ((e: KeyboardEvent) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  open();
                })
              }
            >
              <rect className="bc-sheet-thin" x={c.x} y={c.y} width={c.w} height={c.h} />
              <text className="bc-sheet-text" x={c.x + 1} y={c.y + 2} fontSize={TEXT.label} dominantBaseline="central" aria-hidden="true">
                {c.label}
              </text>
              {c.key === "projection" ? (
                <Projection cell={c} angle={l.angle} />
              ) : (
                editing !== c.key && (
                  <text
                    className="bc-sheet-text"
                    x={c.x + c.w / 2}
                    y={c.y + c.h / 2 + 1.2}
                    fontSize={c.size}
                    textAnchor="middle"
                    dominantBaseline="central"
                    aria-hidden="true"
                  >
                    {c.value}
                  </text>
                )
              )}
            </g>
          );
        })}
      </g>
    </g>
  );
}
