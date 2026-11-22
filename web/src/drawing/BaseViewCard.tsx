import { useId } from "react";
import { Dialog } from "@bettercad/ui";
import { SCALES, scaleLabel } from "@bettercad/kernel/drawing";
import { DIRECTIONS, directionOf, type ViewChoice } from "./views";

/** A thing a view can show besides the whole model. */
export interface ShowOption {
  id: string;
  name: string;
}

/** What the Show list picked, as the list's value: "all", "c:<component>" or "b:<body>". */
const showValue = (s: ViewChoice["shows"]) => ("all" in s ? "all" : "component" in s ? `c:${s.component}` : `b:${s.bodies[0] ?? ""}`);
const showOf = (v: string): ViewChoice["shows"] => (v === "all" ? { all: true } : v.startsWith("c:") ? { component: v.slice(2) } : { bodies: [v.slice(2)] });

export interface BaseViewCardProps {
  /** Changing a view that is already placed, rather than placing a new one. */
  editing?: boolean;
  choice: ViewChoice;
  onChoice: (c: ViewChoice) => void;
  components: ShowOption[];
  bodies: ShowOption[];
  /** The scale Fit works out, once the view is known. */
  fit?: number;
  /** A projected view (#562): it shows what its parent shows from a side of it, so only its scale and lines change. */
  projected?: boolean;
  /** Why the view can't be placed yet: still being worked out, or nothing to draw. */
  wait?: string;
  onCancel: () => void;
  onDone: () => void;
}

/**
 * The Base view card (#561): what the view shows, which way it looks, its scale and its lines. While placing, the
 * view follows the pointer and a click on the sheet puts it down; Place puts it in the middle of the clear space.
 */
export function BaseViewCard({ editing, projected, choice, onChoice, components, bodies, fit, wait, onCancel, onDone }: BaseViewCardProps) {
  const id = useId();
  const direction = directionOf(choice.direction);
  return (
    <Dialog
      open
      title={projected ? "Projected view" : "Base view"}
      icon="drawing"
      className="bc-view-card"
      width={300}
      busy={!!wait}
      onCancel={onCancel}
      onDone={onDone}
      doneLabel={editing ? "Done" : "Place"}
    >
      <div className="bc-sheet-card">
        {!projected && (
          <>
            <label className="bc-field-label" htmlFor={`${id}-show`}>
              Show
            </label>
            <select
              id={`${id}-show`}
              className="bc-select"
              value={showValue(choice.shows)}
              onChange={(e) => onChoice({ ...choice, shows: showOf(e.target.value) })}
            >
              <option value="all">The whole model</option>
              {components.length > 0 && (
                <optgroup label="Components">
                  {components.map((c) => (
                    <option key={c.id} value={`c:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {bodies.length > 1 && (
                <optgroup label="Bodies">
                  {bodies.map((b) => (
                    <option key={b.id} value={`b:${b.id}`}>
                      {b.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            <label className="bc-field-label" htmlFor={`${id}-direction`}>
              Direction
            </label>
            <select
              id={`${id}-direction`}
              className="bc-select"
              value={direction?.id ?? "own"}
              onChange={(e) => {
                const d = DIRECTIONS.find((x) => x.id === e.target.value);
                if (d) onChoice({ ...choice, direction: d.direction });
              }}
            >
              {!direction && <option value="own">As placed</option>}
              {DIRECTIONS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </>
        )}

        <label className="bc-field-label" htmlFor={`${id}-scale`}>
          Scale
        </label>
        <select
          id={`${id}-scale`}
          className="bc-select"
          value={choice.scale ?? "fit"}
          onChange={(e) => {
            const next = { ...choice };
            if (e.target.value === "fit") delete next.scale;
            else next.scale = Number(e.target.value);
            onChoice(next);
          }}
        >
          <option value="fit">{projected ? `As its parent${fit ? `, ${scaleLabel(fit)}` : ""}` : fit ? `Fit, ${scaleLabel(fit)}` : "Fit"}</option>
          {choice.scale !== undefined && !(SCALES as readonly number[]).includes(choice.scale) && (
            <option value={choice.scale}>{scaleLabel(choice.scale)}</option>
          )}
          {[...SCALES].reverse().map((s) => (
            <option key={s} value={s}>
              {scaleLabel(s)}
            </option>
          ))}
        </select>

        <label className="bc-check">
          <input type="checkbox" checked={choice.hidden} onChange={(e) => onChoice({ ...choice, hidden: e.target.checked })} />
          <span>Hidden edges, dashed</span>
        </label>
        <label className="bc-check">
          <input type="checkbox" checked={choice.tangent} onChange={(e) => onChoice({ ...choice, tangent: e.target.checked })} />
          <span>Tangent edges, where a fillet meets a flat</span>
        </label>
        <p className="bc-note" role="status">
          {wait ?? (editing ? "Drag the view on the sheet to move it." : "Click the sheet to put the view down, or choose Place.")}
        </p>
      </div>
    </Dialog>
  );
}
