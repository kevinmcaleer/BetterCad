import { Button, MenuButton, NumberField, type MenuEntry } from "@bettercad/ui";
import { GAP_FITS, fitGap, gapFitNote, gapLabel, type FitGaps, type FitId } from "../state/document";

/** A cut's fit (#183): a named fit, a custom gap, or none. */
export interface FitChoice {
  fit: FitId | null;
  /** The custom gap on each side, mm, used when `fit` is null. 0 is no gap. */
  gap: number;
}

export const NO_FIT: FitChoice = { fit: null, gap: 0 };

/** The gap a choice comes to, mm, with the printer's tuning. */
export const choiceGap = (c: FitChoice, tuned?: FitGaps) => (c.fit ? fitGap(c.fit, tuned) : c.gap);

/** "Sliding fit, 0.25 mm gap each side", "No gap" or a custom gap. */
export function choiceLabel(c: FitChoice, tuned?: FitGaps): string {
  const gap = choiceGap(c, tuned);
  return c.fit || gap > 0 ? gapLabel(gap, c.fit ?? undefined) : "No gap";
}

export interface FitMenuProps {
  value: FitChoice;
  onChange: (c: FitChoice) => void;
  /** The printer's tuned gaps. */
  tuned?: FitGaps;
}

/** The Fit menu for a cut (#183): None, the named fits with their gaps, or Custom with a gap field. */
export function FitMenu({ value, onChange, tuned }: FitMenuProps) {
  const custom = !value.fit && value.gap > 0;
  const entries: MenuEntry[] = [
    { id: "none", label: "No gap", checked: !value.fit && !custom, onSelect: () => onChange(NO_FIT) },
    ...GAP_FITS.map((f) => ({
      id: f.id,
      label: gapLabel(fitGap(f.id, tuned), f.id),
      checked: value.fit === f.id,
      onSelect: () => onChange({ fit: f.id, gap: 0 }),
    })),
    { id: "custom", label: "Custom gap", checked: custom, onSelect: () => onChange({ fit: null, gap: custom ? value.gap : 0.3 }) },
  ];
  const title = value.fit ? gapFitNote(value.fit) : "Grow the cut so a printed part fits in the space it leaves";
  return (
    <>
      <MenuButton label="Fit" entries={entries} trigger={(p) => <Button {...p} label={choiceLabel(value, tuned)} title={title} />} />
      {custom && (
        <span className="bc-sk-fields">
          <NumberField label="Gap" value={value.gap} min={0} max={2} unit="mm" precision={2} onCommit={(v) => onChange({ fit: null, gap: v })} />
        </span>
      )}
    </>
  );
}
