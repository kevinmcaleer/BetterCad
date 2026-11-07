import { ArmedBar, Button } from "@bettercad/ui";
import type { Part } from "../state/document";

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
  onApply: () => void;
  onCancel: () => void;
}

/** Combine's strip (#66): the body to keep is the first one picked; Shift-click adds the bodies to join, cut or intersect. */
export function CombineBar({ picked, op, onOp, keepTools, onKeepTools, onApply, onCancel }: CombineBarProps) {
  const [target, ...tools] = picked;
  const note = !target
    ? "Click the body to keep."
    : !tools.length
      ? `Keeping ${target.name}. Shift-click the bodies to ${op === "join" ? "join to it" : op === "cut" ? "cut from it" : "intersect with it"}.`
      : `${tools.length === 1 ? tools[0]!.name : `${tools.length} bodies`} ${op === "join" ? "into" : op === "cut" ? "out of" : "with"} ${target.name}.`;
  return (
    <ArmedBar title="Combine" icon="combine">
      <span role="group" aria-label="Operation" className="bc-segmented">
        {OPS.map((o) => (
          <Button key={o.id} label={o.label} title={o.title} on={op === o.id} onClick={() => onOp(o.id)} />
        ))}
      </span>
      <Button label="Keep tools" title="Leave the other bodies in the model" on={keepTools} onClick={() => onKeepTools(!keepTools)} />
      <span className="bc-armed-note">{note}</span>
      <Button kind="cancel" label="Cancel" title="Put the tool down" shortcut="Esc" onClick={onCancel} />
      <Button kind="done" label="Combine" title="Combine the bodies" shortcut="Enter" disabled={!tools.length} onClick={onApply} />
    </ArmedBar>
  );
}
