import { useId } from "react";
import { Dialog } from "@bettercad/ui";

export interface DimensionCardProps {
  /** How many things are picked, and whether they already make a size that can be placed. */
  picked: number;
  ready: boolean;
  /** The drawing's decimal places (0 to 3). */
  decimals: number;
  onDecimals: (places: number) => void;
  /** Puts the size down just clear of its view, for when there is no pointer. */
  onPlace: () => void;
  /** Esc: lets go of what is picked, or finishes when nothing is. */
  onBack: () => void;
  onFinish: () => void;
}

const PLACES = ["No decimal places", "1 decimal place", "2 decimal places", "3 decimal places"];

/** The Dimension tool's card (#564): what to click next, and how many decimal places the drawing's sizes show. */
export function DimensionCard({ picked, ready, decimals, onDecimals, onPlace, onBack, onFinish }: DimensionCardProps) {
  const id = useId();
  const how = !picked
    ? "Click an edge for its length, a circle for its size, or a point to measure from. Tab moves between them."
    : !ready
      ? "Now click a second point or an edge to measure to."
      : picked === 1
        ? "Click the sheet to place the size, or click a second edge or point to measure between them."
        : "Click the sheet to place the size.";
  return (
    <Dialog
      open
      title="Dimension"
      icon="drawing"
      className="bc-view-card"
      width={300}
      onCancel={picked ? onBack : onFinish}
      onDone={ready ? onPlace : onFinish}
      doneLabel={ready ? "Place" : "Finish"}
    >
      <div className="bc-sheet-card">
        <label className="bc-field-label" htmlFor={`${id}-places`}>
          Sizes show
        </label>
        <select id={`${id}-places`} className="bc-select" value={decimals} onChange={(e) => onDecimals(Number(e.target.value))}>
          {PLACES.map((label, i) => (
            <option key={label} value={i}>
              {label}
            </option>
          ))}
        </select>
        <p className="bc-note" role="status">
          {how}
        </p>
      </div>
    </Dialog>
  );
}
