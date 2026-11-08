import { useRef } from "react";
import { Button, NumberField } from "@bettercad/ui";
import { JOINT_KINDS, clampJoint, jointValue, movable, type JointFeature, type Pose } from "../state/document";

export interface PoseControlsProps {
  joints: JointFeature[];
  pose: Pose | undefined;
  /** Live, while a slider moves or a field scrubs. */
  onChange: (id: string, value: number) => void;
  /** The move is done: keep it in the model. */
  onCommit: (id: string, value: number) => void;
  /** Puts every joint home; left out when there is only one joint's controls to show. */
  onHome?: () => void;
}

/** The range a joint's slider covers: its limits, or a whole turn for a wheel. */
const range = (j: JointFeature) => (j.kind === "continuous" ? { min: -180, max: 180 } : { min: Math.min(j.lower, j.upper), max: Math.max(j.lower, j.upper) });

/**
 * Posing (#173): a slider and a field for each joint that moves, in degrees or mm and kept to its limits. Trying the
 * mechanism isn't a step on the timeline: the pose is saved with the view.
 */
export function PoseControls({ joints, pose, onChange, onCommit, onHome }: PoseControlsProps) {
  // The last value a slider moved to, so letting go keeps it even before the new pose comes back round.
  const last = useRef(new Map<string, number>());
  const moving = joints.filter(movable);
  if (!moving.length) return <p className="bc-note">A fixed joint doesn't move.</p>;
  const home = moving.every((j) => jointValue(j, pose) === 0);
  return (
    <div className="bc-pose">
      {moving.map((j) => {
        const v = jointValue(j, pose);
        const { min, max } = range(j);
        const unit = j.kind === "prismatic" ? "mm" : "°";
        const what = j.kind === "prismatic" ? "Distance" : "Angle";
        const kind = JOINT_KINDS.find((k) => k.id === j.kind)!.label;
        const commit = (x: number) => {
          last.current.delete(j.id);
          onCommit(j.id, clampJoint(j, x));
        };
        return (
          <fieldset key={j.id} className="bc-pose-joint">
            <legend className="bc-pose-name">{`${j.name}, ${kind.toLowerCase()}`}</legend>
            <input
              type="range"
              className="bc-pose-slider"
              aria-label={what}
              aria-valuetext={`${Math.round(v * 10) / 10} ${unit === "mm" ? "mm" : "degrees"}`}
              min={min}
              max={max}
              step={unit === "mm" ? 0.5 : 1}
              value={v}
              onChange={(e) => {
                const x = clampJoint(j, Number(e.currentTarget.value));
                last.current.set(j.id, x);
                onChange(j.id, x);
              }}
              onPointerUp={() => commit(last.current.get(j.id) ?? v)}
              onKeyUp={(e) => {
                if (last.current.has(j.id) && /^(Arrow|Page|Home|End)/.test(e.key)) commit(last.current.get(j.id)!);
              }}
            />
            <NumberField
              label={what}
              value={v}
              unit={unit}
              min={j.kind === "continuous" ? undefined : min}
              max={j.kind === "continuous" ? undefined : max}
              onChange={(x) => onChange(j.id, clampJoint(j, x))}
              onCommit={commit}
            />
          </fieldset>
        );
      })}
      {onHome && (
        <Button
          icon="home"
          label="Home"
          title="Put every joint back where it was made"
          disabled={home}
          onClick={() => {
            if (!home) onHome();
          }}
        />
      )}
    </div>
  );
}
