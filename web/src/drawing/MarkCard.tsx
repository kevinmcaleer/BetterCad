import { useId } from "react";
import { Dialog } from "@bettercad/ui";
import { MARK_NAMES } from "./marks";
import type { MarkTool } from "./MarkLayer";

export interface MarkCardProps {
  tool: MarkTool;
  /** How many things are picked so far: the first edge of two, or a pattern's holes. */
  picked: number;
  /** A pattern's holes sit on a circle, so a pitch circle can join them. */
  onCircle?: boolean;
  join: "circle" | "lines";
  onJoin: (join: "circle" | "lines") => void;
  /** Add the pattern from what is picked. */
  onAdd: () => void;
  onFinish: () => void;
}

const HOW: Record<MarkTool, [string, string]> = {
  "centre-mark": ["Click a hole or a round edge to mark its centre. Tab moves between them.", ""],
  "centre-pattern": [
    "Click the holes of a pattern. Holes the same size on one circle or row come in together.",
    "Click a hole to add it or leave it out, then choose Add.",
  ],
  "centre-line": ["Click a hole or pin seen from the side for its axis, or two edges for the line midway between them.", "Now click the second edge."],
  extension: ["Click two edges to carry them on to where they would meet.", "Now click the second edge."],
};

/** The card of the armed mark tool (#563): what to click next, and for a pattern how its holes are joined. */
export function MarkCard({ tool, picked, onCircle, join, onJoin, onAdd, onFinish }: MarkCardProps) {
  const id = useId();
  const pattern = tool === "centre-pattern";
  const can = pattern && picked >= 2;
  return (
    <Dialog
      open
      title={MARK_NAMES[tool]}
      icon="drawing"
      className="bc-view-card"
      width={300}
      onCancel={onFinish}
      onDone={can ? onAdd : onFinish}
      doneLabel={can ? "Add" : "Finish"}
    >
      <div className="bc-sheet-card">
        {pattern && picked > 0 && (
          <>
            <label className="bc-field-label" htmlFor={`${id}-join`}>
              Join with
            </label>
            <select id={`${id}-join`} className="bc-select" value={onCircle ? join : "lines"} onChange={(e) => onJoin(e.target.value as "circle" | "lines")}>
              {onCircle && <option value="circle">A pitch circle</option>}
              <option value="lines">Lines</option>
            </select>
          </>
        )}
        <p className="bc-note" role="status">
          {pattern && picked > 0 ? `${picked} ${picked === 1 ? "hole" : "holes"} picked. ${HOW[tool][1]}` : picked > 0 ? HOW[tool][1] : HOW[tool][0]}
        </p>
      </div>
    </Dialog>
  );
}
