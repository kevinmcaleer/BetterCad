import { Button, Icon } from "@bettercad/ui";
import { JOINT_KINDS, movable, type JointFeature, type Part } from "../state/document";
import { PoseControls, type PoseControlsProps } from "./PoseControls";

/** One joint made to or from the selected part, and the part at its other end. */
export interface PartJoint {
  joint: JointFeature;
  /** "moves": the selection is the part this joint moves. "holds": the selection is what it hangs from. */
  role: "moves" | "holds";
  /** The other end's name: a component, or "the base" for a joint fixed to the ground. */
  other: string;
}

export interface PartJointsProps {
  joints: PartJoint[];
  /** The joint picked from the list, drawn brighter in the view. */
  lit: string | null;
  onLight: (id: string | null) => void;
  /** Opens the joint's panel to change it; left out when the model can't be changed. */
  onEdit?: (id: string) => void;
  /** Links the joint to others so they move together (a motion link); left out when there's nothing to link it to. */
  onLink?: (id: string) => void;
  /** The pose sliders, for the joints that move. */
  pose?: Omit<PoseControlsProps, "joints" | "onHome">;
}

/** Every joint made to and from the bodies' components: the ones that move them, and the ones they hold. */
export function jointsOf(parts: Part[], joints: JointFeature[], components: { id: string; name: string }[]): PartJoint[] {
  const links = new Set(parts.flatMap((p) => (p.link ? [p.link] : [])));
  if (!links.size) return [];
  const name = (id: string | null) => (id === null ? "the base" : (components.find((c) => c.id === id)?.name ?? "a component"));
  return joints.flatMap((j): PartJoint[] => {
    if (links.has(j.child)) return [{ joint: j, role: "moves", other: name(j.parent) }];
    if (j.parent !== null && links.has(j.parent)) return [{ joint: j, role: "holds", other: name(j.child) }];
    return [];
  });
}

/** What a joint does, seen from the selected part: "Hinge joint, on Chassis" or "Wheel joint, holds Wheel 2". */
export function jointRelation({ joint, role, other }: PartJoint): string {
  const kind = JOINT_KINDS.find((k) => k.id === joint.kind)?.label ?? "Joint";
  return `${kind} joint, ${role === "moves" ? "on" : "holds"} ${other}`;
}

/**
 * Every joint made to and from the selected bodies or component, in This part. Click a joint to show it in the view,
 * double-click it or press Edit to change it; one that moves keeps its pose slider.
 */
export function PartJoints({ joints, lit, onLight, onEdit, onLink, pose }: PartJointsProps) {
  return (
    <ul className="bc-part-joints" aria-label="Joints of this part">
      {joints.map((pj) => {
        const j = pj.joint;
        const on = lit === j.id;
        return (
          <li key={j.id} className={on ? "bc-part-joint bc-on" : "bc-part-joint"}>
            <div className="bc-part-joint-head">
              <button
                type="button"
                className="bc-part-joint-pick"
                aria-pressed={on}
                data-tip={onEdit ? `Show ${j.name} in the view. Double-click to edit it.` : `Show ${j.name} in the view`}
                onClick={() => onLight(on ? null : j.id)}
                onDoubleClick={() => onEdit?.(j.id)}
              >
                <Icon name="joint" size={16} />
                <span className="bc-part-joint-name">{j.name}</span>
                <span className="bc-part-joint-what">{jointRelation(pj)}</span>
              </button>
              {onLink && movable(j) && (
                <Button
                  icon="link"
                  label="Link"
                  size="dense"
                  title={`Make other joints move with ${j.name}`}
                  aria-label={`Link ${j.name} to other joints`}
                  onClick={() => onLink(j.id)}
                />
              )}
              {onEdit && <Button icon="pencil" label="Edit" size="dense" title={`Edit ${j.name}`} aria-label={`Edit ${j.name}`} onClick={() => onEdit(j.id)} />}
            </div>
            {pose && movable(j) && <PoseControls {...pose} joints={[j]} onHome={undefined} bare />}
          </li>
        );
      })}
    </ul>
  );
}
