import { useId } from "react";
import { Button, PropsPanel } from "@bettercad/ui";
import type { Drawing, DrawingSheet } from "@bettercad/kernel/drawing";
import type { ModelDoc } from "../state/document";
import { sizeWith } from "./dimensions";
import { sizeSource } from "./source";
import type { SelectedSize } from "./DrawingView";

export interface SizePropsProps {
  drawing: Pick<Drawing, "decimals">;
  sheet: DrawingSheet;
  /** The size selected on the sheet, and what it measures. */
  size: SelectedSize;
  doc: Pick<ModelDoc, "features">;
  onSheet: (change: (s: DrawingSheet) => DrawingSheet, label: string) => void;
  /** Opens the step that sets the size, and the sketch dimension when it is one. */
  onEditModel: (feature: string, dimension?: string) => void;
}

/**
 * Properties of a size selected on a drawing sheet (#564): what it measures, its own decimal places, and where the
 * model sets it. A drawing's sizes report; Edit in model goes to the sketch dimension or step that drives one.
 */
export default function SizeProps({ drawing, sheet, size, doc, onSheet, onEditModel }: SizePropsProps) {
  const field = useId();
  const d = sheet.dimensions.find((x) => x.id === size.id);
  if (!d) return null;
  const places = d.decimals ?? drawing.decimals;
  const from = sizeSource(doc, d, size.value);
  const kind = d.kind === "linear" ? "Length" : d.kind === "angle" ? "Angle" : d.kind === "radius" ? "Radius" : "Diameter";
  const setPlaces = (next: number | undefined) =>
    onSheet(
      (s) => ({
        ...s,
        dimensions: s.dimensions.map((x) => {
          if (x.id !== size.id) return x;
          // A size changed by hand is no longer Auto dimension's to replace.
          const out = { ...x };
          delete out.auto;
          if (next === undefined) delete out.decimals;
          else out.decimals = next;
          return out;
        }),
      }),
      "Decimal places",
    );
  return (
    <PropsPanel
      sections={[
        {
          id: "drawing-size",
          title: "Dimension",
          content: (
            <>
              <dl className="bc-facts">
                <dt>{kind}</dt>
                <dd>{sizeWith(size.value, places, d.tolerance, "", size.unit === "mm" ? " mm" : "°")}</dd>
              </dl>
              <label className="bc-field-label" htmlFor={field}>
                Decimal places
              </label>
              <select
                id={field}
                className="bc-select"
                value={d.decimals ?? ""}
                onChange={(e) => setPlaces(e.target.value === "" ? undefined : Number(e.target.value))}
              >
                <option value="">{`As the drawing (${drawing.decimals})`}</option>
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <p className="bc-note">
                {from
                  ? `Set by ${from.label}. A drawing's sizes follow the model, so change it there.`
                  : "No one sketch dimension or step sets this size. It follows the model as it is."}
              </p>
              {from && <Button label="Edit in model" icon="sketch" variant="secondary" onClick={() => onEditModel(from.feature, from.dimension)} />}
            </>
          ),
        },
      ]}
    />
  );
}
