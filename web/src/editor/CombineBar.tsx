import { Button, FeatureCheck, FeaturePanel, FeatureRow, PanelNote } from "@bettercad/ui";
import type { FitGaps, Part } from "../state/document";
import { FitMenu, type FitChoice } from "../fit/FitMenu";

export type CombineOp = "join" | "cut" | "intersect";

const OPS: { id: CombineOp; label: string; title: string }[] = [
  { id: "join", label: "Join", title: "Add the other bodies to the first" },
  { id: "cut", label: "Cut", title: "Cut the other bodies away from the first" },
  { id: "intersect", label: "Intersect", title: "Keep only where the bodies overlap" },
];

export interface CombineBarProps {
  /** The selection in the order it was picked: the first is kept, the rest are the tools. */
  picked: Part[];
  op: CombineOp;
  onOp: (op: CombineOp) => void;
  keepTools: boolean;
  onKeepTools: (on: boolean) => void;
  /** A cut's fit (#183): the tools grow by its gap first. */
  fit: FitChoice;
  onFit: (c: FitChoice) => void;
  /** The printer's tuned gaps. */
  tuned?: FitGaps;
  onApply: () => void;
  onCancel: () => void;
  /** Why the preview of this combine does not build, if it does not. */
  error?: string | null;
}

/** Combine's panel (#66): the body to keep is the first one picked; Shift-click adds the bodies to join, cut or intersect. */
export function CombineBar({ picked, op, onOp, keepTools, onKeepTools, fit, onFit, tuned, onApply, onCancel, error }: CombineBarProps) {
  const [target, ...tools] = picked;
  const note = !target
    ? "Click the body to keep."
    : !tools.length
      ? `Keeping ${target.name}. Shift-click the bodies to ${op === "join" ? "join to it" : op === "cut" ? "cut from it" : "intersect with it"}.`
      : `${tools.length === 1 ? tools[0]!.name : `${tools.length} bodies`} ${op === "join" ? "into" : op === "cut" ? "out of" : "with"} ${target.name}.`;
  return (
    <FeaturePanel
      title="Combine"
      icon="combine"
      cancel={{ title: "Put the tool down", onClick: onCancel }}
      ok={{ label: "Combine", title: "Combine the bodies", disabled: !tools.length, onClick: onApply }}
    >
      <FeatureRow label="Operation">
        <span role="group" aria-label="Operation" className="bc-segmented">
          {OPS.map((o) => (
            <Button key={o.id} label={o.label} title={o.title} on={op === o.id} onClick={() => onOp(o.id)} />
          ))}
        </span>
      </FeatureRow>
      {op === "cut" && (
        <FeatureRow label="Fit">
          <FitMenu value={fit} onChange={onFit} tuned={tuned} />
        </FeatureRow>
      )}
      <FeatureCheck label="Keep tools" title="Leave the other bodies in the model" on={keepTools} onChange={onKeepTools} />
      <PanelNote>{note}</PanelNote>
      {error && <PanelNote tone="error">{error}</PanelNote>}
    </FeaturePanel>
  );
}
