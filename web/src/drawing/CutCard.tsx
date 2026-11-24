import { useId } from "react";
import { Button, Dialog, NumberField } from "@bettercad/ui";
import { SCALES, scaleLabel } from "@bettercad/kernel/drawing";
import type { CutWay } from "./cuts";

export type CutTool = "section" | "detail" | "break";
export const CUT_TOOLS: readonly CutTool[] = ["section", "detail", "break"];
export const isCutTool = (t: string | null | undefined): t is CutTool => !!t && (CUT_TOOLS as readonly string[]).includes(t);
export const CUT_NAMES: Record<CutTool, string> = { section: "Section view", detail: "Detail view", break: "Break" };

export interface CutCardProps {
  tool: CutTool;
  /** The views on the sheet, to cut. */
  views: { id: string; name: string }[];
  from: string | null;
  onFrom: (id: string) => void;
  /** Which way the cutting line, or the stretch a break leaves out, runs. */
  way: CutWay;
  onWay: (way: CutWay) => void;
  /** A section: look from the other side. */
  flip: boolean;
  onFlip: (flip: boolean) => void;
  /** A detail: its circle's radius in the model's millimetres, and the scale it is drawn at. */
  radius: number;
  onRadius: (mm: number) => void;
  scale: number;
  onScale: (scale: number) => void;
  /** A break: one end is picked and the other is waited for. */
  started?: boolean;
  /** Why nothing can be put down yet. */
  wait?: string;
  /** Do it through the middle of the view, for a keyboard. */
  onPlace: () => void;
  onFinish: () => void;
}

const HOW: Record<CutTool, string> = {
  section: "Click the view where the cut goes. It snaps to holes and the middle. The arrows show which way the section looks.",
  detail: "Click the view where the detail's circle goes.",
  break: "Click the view at each end of the stretch to leave out.",
};
const MIDDLE: Record<CutTool, string> = { section: "Cut through the middle", detail: "Circle the middle", break: "Leave out the middle third" };

/**
 * The card of the Section view, Detail view and Break tools (#571): the view to cut and how. The pointer says where
 * on the sheet; the card's button does the same through the middle of the view, for a keyboard.
 */
export function CutCard(p: CutCardProps) {
  const id = useId();
  const { tool } = p;
  return (
    <Dialog open title={CUT_NAMES[tool]} icon="drawing" className="bc-view-card" width={300} onCancel={p.onFinish} onDone={p.onFinish} doneLabel="Finish">
      <div className="bc-sheet-card">
        <label className="bc-field-label" htmlFor={`${id}-from`}>
          {tool === "break" ? "View" : "From"}
        </label>
        <select id={`${id}-from`} className="bc-select" value={p.from ?? ""} onChange={(e) => p.onFrom(e.target.value)}>
          {!p.from && <option value="">Pick a view</option>}
          {p.views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        {tool !== "detail" && (
          <>
            <label className="bc-field-label" htmlFor={`${id}-way`}>
              {tool === "section" ? "Cutting line" : "Leave out"}
            </label>
            <select id={`${id}-way`} className="bc-select" value={p.way} onChange={(e) => p.onWay(e.target.value as CutWay)}>
              {tool === "section" ? (
                <>
                  <option value="across">Across the view</option>
                  <option value="up">Up the view</option>
                </>
              ) : (
                <>
                  <option value="up">A stretch of its width</option>
                  <option value="across">A stretch of its height</option>
                </>
              )}
            </select>
          </>
        )}
        {tool === "section" && (
          <label className="bc-check">
            <input type="checkbox" checked={p.flip} onChange={(e) => p.onFlip(e.target.checked)} />
            Look from the other side
          </label>
        )}
        {tool === "detail" && (
          <>
            <span className="bc-field-label">Circle</span>
            <NumberField label="Radius" value={p.radius} unit="mm" min={0.1} step={1} onCommit={(v) => p.onRadius(v)} />
            <label className="bc-field-label" htmlFor={`${id}-scale`}>
              Scale
            </label>
            <select id={`${id}-scale`} className="bc-select" value={String(p.scale)} onChange={(e) => p.onScale(Number(e.target.value))}>
              {(SCALES as readonly number[]).includes(p.scale) ? null : <option value={String(p.scale)}>{scaleLabel(p.scale)}</option>}
              {SCALES.map((s) => (
                <option key={s} value={String(s)}>
                  {scaleLabel(s)}
                </option>
              ))}
            </select>
          </>
        )}
        <p className="bc-note" role="status">
          {p.wait ?? (tool === "break" && p.started ? "Now click the other end." : HOW[tool])}
        </p>
        <span className="bc-view-card-place">
          <Button label={MIDDLE[tool]} variant="secondary" disabled={!!p.wait} onClick={p.onPlace} />
        </span>
      </div>
    </Dialog>
  );
}
