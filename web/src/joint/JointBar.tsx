import { Button, FeaturePanel, FeatureRow, NumberField, PanelNote } from "@bettercad/ui";
import { JOINT_KINDS, limitUnit, type JointKind } from "../state/document";
import type { JointSession } from "./useJoint";

/**
 * The panel for the Joint tool (#172): while picking, what to click next (and Base for the parent); once made, the
 * kind in plain words with URDF's name beside it, the limits and the name.
 */
export function JointBar({ x, error, scope, onCancel }: { x: JointSession; error?: string; scope?: Record<string, number>; onCancel: () => void }) {
  const f = x.feature;
  if (!f) {
    return (
      <FeaturePanel title="Joint" icon="joint" cancel={{ title: "Put the tool down", onClick: onCancel }}>
        {x.child !== null && <PanelNote>{`Moves: ${x.nameOf(x.child)}`}</PanelNote>}
        {x.parent !== undefined && <PanelNote>{`Hangs from: ${x.nameOf(x.parent)}`}</PanelNote>}
        <PanelNote>{x.help}</PanelNote>
        {x.stage === "parent" && (
          <FeatureRow label="Parent">
            <Button label="Base" title="Hang it from Base" shortcut="Enter" onClick={() => x.pickParent(null)} />
          </FeatureRow>
        )}
      </FeaturePanel>
    );
  }
  const unit = limitUnit(f.kind);
  return (
    <FeaturePanel
      title="Joint"
      icon="joint"
      onFieldEnter={() => x.done()}
      cancel={{ title: "Take the joint back", onClick: x.cancel }}
      ok={{ title: "Keep the joint", onClick: x.done }}
    >
      <PanelNote>{`${x.nameOf(f.child)} on ${x.nameOf(f.parent)}`}</PanelNote>
      <FeatureRow label="Kind">
        <span role="group" aria-label="Kind" className="bc-segmented bc-stack">
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
      </FeatureRow>
      {unit &&
        (["lower", "upper"] as const).map((which) => (
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
      {error && <PanelNote tone="error">{error}</PanelNote>}
    </FeaturePanel>
  );
}
