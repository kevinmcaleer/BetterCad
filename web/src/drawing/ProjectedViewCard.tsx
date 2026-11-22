import { useId } from "react";
import { Button, Dialog } from "@bettercad/ui";
import { SIDES, sideId, type Side } from "./projected";

export interface ProjectedViewCardProps {
  /** The views on the sheet, to project from. */
  views: { id: string; name: string }[];
  from: string | null;
  onFrom: (id: string) => void;
  side: Side;
  onSide: (side: Side) => void;
  /** Why a view can't be put down yet. */
  wait?: string;
  onPlace: () => void;
  onFinish: () => void;
}

/**
 * The Projected view card (#562): the view to project from and the side to put the new one on. The pointer does
 * both on the sheet; the card is the same thing for a keyboard, and stays up so you can place several.
 */
export function ProjectedViewCard({ views, from, onFrom, side, onSide, wait, onPlace, onFinish }: ProjectedViewCardProps) {
  const id = useId();
  return (
    <Dialog open title="Projected view" icon="drawing" className="bc-view-card" width={300} onCancel={onFinish} onDone={onFinish} doneLabel="Finish">
      <div className="bc-sheet-card">
        <label className="bc-field-label" htmlFor={`${id}-from`}>
          From
        </label>
        <select id={`${id}-from`} className="bc-select" value={from ?? ""} onChange={(e) => onFrom(e.target.value)}>
          {!from && <option value="">Pick a view</option>}
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>

        <label className="bc-field-label" htmlFor={`${id}-side`}>
          Side
        </label>
        <select
          id={`${id}-side`}
          className="bc-select"
          value={sideId(side)}
          onChange={(e) => {
            const s = SIDES.find((x) => x.id === e.target.value);
            if (s) onSide(s.side);
          }}
        >
          {SIDES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <p className="bc-note" role="status">
          {wait ?? "Move the pointer away from the view and click to put a view down. Click again for more."}
        </p>
        <span className="bc-view-card-place">
          <Button label="Place" variant="secondary" disabled={!!wait} onClick={onPlace} />
        </span>
      </div>
    </Dialog>
  );
}
