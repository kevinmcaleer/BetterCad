import { useId, useState } from "react";
import { Dialog, NumberField } from "@bettercad/ui";
import type { DimTolerance } from "@bettercad/kernel/drawing";

type Kind = "none" | "plus-minus" | "limits" | "press" | "sliding" | "loose";
const KINDS: { id: Kind; label: string }[] = [
  { id: "none", label: "None" },
  { id: "plus-minus", label: "Plus and minus" },
  { id: "limits", label: "Limits" },
  { id: "press", label: "Press fit" },
  { id: "sliding", label: "Sliding fit" },
  { id: "loose", label: "Loose fit" },
];
const kindOf = (t: DimTolerance | undefined): Kind => (!t ? "none" : "fit" in t ? t.fit : t.limits ? "limits" : "plus-minus");

export interface ToleranceCardProps {
  /** The size as it reads now, for the card's title. */
  size: string;
  tolerance?: DimTolerance;
  /** The gap each side each named fit has in this model's print settings. */
  gapOf: (fit: "press" | "sliding" | "loose") => number;
  onDone: (tolerance: DimTolerance | undefined) => void;
  onCancel: () => void;
}

/**
 * A dimension's tolerance (#573): none, plus and minus, limits, or one of the printer's fits. Plus and minus are
 * both typed as positive numbers.
 */
export function ToleranceCard({ size, tolerance, gapOf, onDone, onCancel }: ToleranceCardProps) {
  const id = useId();
  const [kind, setKind] = useState<Kind>(kindOf(tolerance));
  const had = tolerance && "plus" in tolerance ? tolerance : undefined;
  const [plus, setPlus] = useState(had?.plus ?? 0.1);
  const [minus, setMinus] = useState(had?.minus ?? 0.1);
  const numbers = kind === "plus-minus" || kind === "limits";
  const fit = kind === "press" || kind === "sliding" || kind === "loose" ? kind : undefined;
  const done = () =>
    onDone(
      kind === "none"
        ? undefined
        : fit
          ? { fit, gap: gapOf(fit) }
          : { plus: Math.abs(plus), minus: Math.abs(minus), ...(kind === "limits" ? { limits: true } : {}) },
    );
  return (
    <Dialog open title={`Tolerance on ${size}`} icon="dimension" className="bc-view-card" width={300} onCancel={onCancel} onDone={done}>
      <div className="bc-sheet-card">
        <label className="bc-field-label" htmlFor={`${id}-kind`}>
          Tolerance
        </label>
        <select id={`${id}-kind`} className="bc-select" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        {numbers && (
          <>
            <span className="bc-field-label">Over</span>
            <NumberField label="Plus" value={plus} unit="mm" min={0} step={0.05} precision={3} onCommit={setPlus} />
            <span className="bc-field-label">Under</span>
            <NumberField label="Minus" value={minus} unit="mm" min={0} step={0.05} precision={3} onCommit={setMinus} />
          </>
        )}
        <p className="bc-note" role="status">
          {fit
            ? `A ${fit} fit leaves ${gapOf(fit)} mm each side with this model's print settings.`
            : kind === "limits"
              ? "The largest and smallest sizes are written in place of the size."
              : kind === "none"
                ? "The size is written on its own."
                : "Written after the size: ±0.1 when both are the same."}
        </p>
      </div>
    </Dialog>
  );
}
