import { useRef } from "react";
import { Button, NumberField } from "@bettercad/ui";
import { JOINT_KINDS, clampJoint, jointValue, movable, type BuiltDrive, type JointFeature, type Pose } from "../state/document";

export interface PoseControlsProps {
  joints: JointFeature[];
  pose: Pose | undefined;
  /** Live, while a slider moves or a field scrubs. */
  onChange: (id: string, value: number) => void;
  /** The move is done: keep it in the model. */
  onCommit: (id: string, value: number) => void;
  /** Puts every joint home; left out when there is only one joint's controls to show. */
  onHome?: () => void;
  /** Drive links (#194): a driven joint says what drives it, and a driver can play through its range. */
  drives?: BuiltDrive[];
  /** The joint playing now, if one is. */
  playing?: string | null;
  onPlay?: (id: string | null) => void;
  /** Every joint's name, for "Driven by". */
  nameOf?: (id: string) => string;
  /** Tool points (#176): joints kept out of the arm's drag, and the toggle; left out when there is no tool point. */
  locked?: string[];
  onLock?: (id: string, locked: boolean) => void;
  /** Leaves out each joint's name: the joint list in This part shows it above the slider. */
  bare?: boolean;
}

/** The range a joint's slider covers: its limits, or a whole turn for a wheel. */
const range = (j: JointFeature) => (j.kind === "continuous" ? { min: -180, max: 180 } : { min: Math.min(j.lower, j.upper), max: Math.max(j.lower, j.upper) });

/**
 * Posing (#173): a slider and a field for each joint that moves, in degrees or mm and kept to its limits. Trying the
 * mechanism isn't a step on the timeline: the pose is saved with the view.
 */
export function PoseControls({
  joints,
  pose,
  onChange,
  onCommit,
  onHome,
  drives = [],
  playing = null,
  onPlay,
  nameOf,
  locked = [],
  onLock,
  bare,
}: PoseControlsProps) {
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
        const by = drives.find((d) => d.driven === j.id);
        const drivesOthers = !by && drives.some((d) => d.driver === j.id);
        return (
          <fieldset key={j.id} className="bc-pose-joint" aria-label={bare ? `${j.name}, ${kind.toLowerCase()}` : undefined}>
            {!bare && <legend className="bc-pose-name">{`${j.name}, ${kind.toLowerCase()}`}</legend>}
            {by && <p className="bc-pose-driven">{`Driven by ${nameOf?.(by.driver) ?? "another joint"}`}</p>}
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
            {onLock && !by && (
              <Button
                icon={locked.includes(j.id) ? "lock" : "unlock"}
                label={locked.includes(j.id) ? "Locked" : "Lock"}
                title={locked.includes(j.id) ? `Let ${j.name} move when you drag the arm` : `Keep ${j.name} still when you drag the arm`}
                size="dense"
                on={locked.includes(j.id)}
                onClick={() => onLock(j.id, !locked.includes(j.id))}
              />
            )}
            {drivesOthers && onPlay && (
              <Button
                icon="stepForward"
                label={playing === j.id ? "Stop" : "Play"}
                title={playing === j.id ? "Stop playing (Esc)" : `Turn ${j.name} through its range to watch the drive`}
                size="dense"
                onClick={() => onPlay(playing === j.id ? null : j.id)}
              />
            )}
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
