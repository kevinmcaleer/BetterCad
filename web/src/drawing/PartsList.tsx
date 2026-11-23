import type { PartsTable } from "./parts";

export interface PartsListProps {
  table: PartsTable;
  /** Right-click, or the menu key. Left out, the list is only drawn. */
  onMenu?: (x: number, y: number) => void;
  /** Delete takes the list off the sheet. */
  onDelete?: () => void;
}

/** The parts list (#574) above the title block, in page millimetres: a table a screen reader can walk row by row. */
export function PartsList({ table, onMenu, onDelete }: PartsListProps) {
  const { box } = table;
  return (
    <g
      className="bc-parts"
      role="table"
      aria-label="Parts list"
      tabIndex={0}
      onContextMenu={(e) => {
        if (!onMenu) return;
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        if (!onDelete || (e.key !== "Delete" && e.key !== "Backspace")) return;
        e.preventDefault();
        onDelete();
      }}
    >
      <rect className="bc-sheet-thick bc-sheet-block" x={box.x} y={box.y} width={box.w} height={box.h} />
      <g className="bc-sheet-thin" aria-hidden="true">
        {table.lines.map((s, i) => (
          <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
        ))}
      </g>
      {table.rows.map((row, i) => (
        <g key={i} role="row" className="bc-sheet-text" fontSize={table.size}>
          {row.cells.map((c, j) => (
            <text key={j} role={i ? "cell" : "columnheader"} x={c.x} y={c.y} textAnchor={c.anchor} dominantBaseline="central">
              {c.text}
            </text>
          ))}
        </g>
      ))}
    </g>
  );
}
