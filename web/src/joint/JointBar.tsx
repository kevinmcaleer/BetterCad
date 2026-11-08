import type { KeyboardEvent } from "react";
import { ArmedBar, Button, NumberField } from "@bettercad/ui";
import { JOINT_KINDS, limitUnit, type JointKind } from "../state/document";
import type { JointSession } from "./useJoint";

/**
 * The strip for the Joint tool (#172): while picking, what to click next (and Base for the parent); once made, the
 * kind in plain words with URDF's name beside it, the limits and the name.
 */
export function JointBar({ x, error, scope, onCancel }: { x: JointSession; error?: string; scope?: Record<string, number>; onCancel: () => void }) {
  const f = x.feature;
  if (!f) {
    return (
      <ArmedBar title="Joint" icon="joint">
        {x.child !== null && <span className="bc-armed-note">{`Moves: ${x.nameOf(x.child)}`}</span>}
        {x.parent !== undefined && <span className="bc-armed-note">{`Hangs from: ${x.nameOf(x.parent)}`}</span>}
        <span className="bc-armed-note">{x.help}</span>
        {x.stage === "parent" && <Button label="Base" title="Hang it from Base" shortcut="Enter" onClick={() => x.pickParent(null)} />}
        <Button kind="cancel" label="Cancel" title="Put the tool down" shortcut="Esc" onClick={onCancel} />
      </ArmedBar>
    );
  }
  const onFieldKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") x.done();
  };
  const unit = limitUnit(f.kind);
  return (
    <ArmedBar title="Joint" icon="joint">
      <span role="group" aria-label="Kind" className="bc-segmented">
        {JOINT_KINDS.map((k) => (
          <Button
            key={k.id}
            label={`${k.label} (${k.urdf})`}
            title={k.title}
            on={f.kind === k.id}
            onClick={() => f.kind !== k.id && x.change({ kind: k.id as JointKind })}
          />
        ))}
      </span>
      {unit && (
        <span className="bc-sk-fields" onKeyDown={onFieldKey}>
          {(["lower", "upper"] as const).map((which) => (
            <NumberField
              key={which}
              label={which === "lower" ? "Lower" : "Upper"}
              unit={unit}
              value={f[which]}
              scope={scope}
              step={unit === "°" ? 5 : 1}
              onCommit={(v, expr) => {
                x.change({ [which]: v });
                x.setFieldExpr(which, expr);
              }}
            />
          ))}
        </span>
      )}
      <span className="bc-armed-note">{`${x.nameOf(f.child)} on ${x.nameOf(f.parent)}`}</span>
      {error && (
        <span className="bc-armed-note bc-armed-error" role="alert">
          {error}
        </span>
      )}
      <Button kind="cancel" label="Cancel" title="Take the joint back" shortcut="Esc" onClick={x.cancel} />
      <Button kind="done" label="Done" title="Keep the joint" shortcut="Enter" onClick={x.done} />
    </ArmedBar>
  );
}
