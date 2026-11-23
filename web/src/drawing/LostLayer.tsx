import type { Problem } from "./follow";

export interface LostLayerProps {
  /** This view's lost marks and dimensions, and what each is called. */
  lost: { problem: Problem; name: string }[];
  /** Right-click, or the menu key: Pick again and Delete. Left out, the warnings are only shown. */
  onMenu?: (problem: Problem, x: number, y: number) => void;
  onDelete?: (problem: Problem) => void;
}

/** A warning triangle, 6 mm across, about the origin. */
export function Warning() {
  return (
    <>
      <path className="bc-lost-sign" d="M0 -3.2L3.6 3H-3.6Z" />
      <path className="bc-lost-mark" d="M0 -1.2V1M0 1.9V2" />
    </>
  );
}

/**
 * Marks and dimensions whose edge or face has gone from the model (#568): each stays where it was as a warning
 * triangle you can tab to, delete, or right-click to pick again. Inside the view's group, y down as SVG draws.
 */
export function LostLayer({ lost, onMenu, onDelete }: LostLayerProps) {
  return (
    <>
      {lost.map(({ problem: p, name }) => (
        <g
          key={`${p.kind}-${p.id}`}
          className="bc-lost"
          role="button"
          aria-label={`${name}. What it was fixed to is no longer in the model.`}
          tabIndex={0}
          transform={`translate(${p.at[0]} ${-p.at[1]})`}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            if (!onMenu) return;
            e.preventDefault();
            e.stopPropagation();
            onMenu(p, e.clientX, e.clientY);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (onDelete && (e.key === "Delete" || e.key === "Backspace")) {
              e.preventDefault();
              onDelete(p);
            } else if (onMenu && (e.key === "Enter" || e.key === " " || e.key === "ContextMenu")) {
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              onMenu(p, r.left + r.width / 2, r.top + r.height / 2);
            }
          }}
        >
          <circle className="bc-lost-hit" r={4.5} />
          <Warning />
        </g>
      ))}
    </>
  );
}
