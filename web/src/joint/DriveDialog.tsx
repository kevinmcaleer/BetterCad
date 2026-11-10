import { useMemo, useState } from "react";
import { Button, Dialog, NumberField } from "@bettercad/ui";
import {
  DRIVE_KINDS,
  addDrive,
  build,
  driveRatioText,
  movable,
  updateDrive,
  type DriveFeature,
  type DriveKind,
  type DriveParams,
  type ModelDoc,
} from "../state/document";

export interface DriveDialogProps {
  doc: ModelDoc;
  /** The drive step to change; none to add one. */
  editing?: DriveFeature;
  /** A motion link: several joints that move with a lead joint at the same speed. Editing one opens this too. */
  together?: boolean;
  /** The joint a new motion link starts from. */
  lead?: string;
  onDone: (params: DriveParams) => void;
  onCancel: () => void;
}

const PREVIEW = "drive-preview";

/**
 * A drive link (#194): which joint drives which, through gears, a belt, a rack or a typed ratio. The ratio is worked out
 * from the teeth when both links have the gears, and shown in words as you choose.
 */
export function DriveDialog(props: DriveDialogProps) {
  return props.together || props.editing?.kind === "together" ? <LinkJointsDialog {...props} /> : <DriveLinkDialog {...props} />;
}

function DriveLinkDialog({ doc, editing, onDone, onCancel }: DriveDialogProps) {
  const { joints } = useMemo(() => build(doc), [doc]);
  const moving = joints.filter(movable);
  const [p, setP] = useState<DriveParams>(() =>
    editing
      ? { kind: editing.kind, driver: editing.driver, driven: editing.driven, ratio: editing.ratio, reverse: editing.reverse }
      : { kind: "gear", driver: moving[0]?.id ?? "", driven: moving[1]?.id ?? "", ratio: 1 },
  );
  const set = (change: Partial<DriveParams>) => setP((o) => ({ ...o, ...change }));
  const preview = useMemo(() => {
    const next = editing ? updateDrive(doc, editing.id, p) : addDrive(doc, p, PREVIEW);
    const id = editing?.id ?? PREVIEW;
    const b = build(next);
    return { drive: b.drives.find((d) => d.id === id), error: b.failed.get(id) };
  }, [doc, editing, p]);
  const kindOf = (id: string) => joints.find((j) => j.id === id)?.kind ?? "revolute";
  const typed = !preview.drive?.fromTeeth;
  const status = preview.error
    ? preview.error
    : preview.drive
      ? `${driveRatioText(preview.drive.multiplier, kindOf(p.driver), kindOf(p.driven))}${preview.drive.fromTeeth ? ", from the teeth" : ""}`
      : "";
  const pick = (which: "driver" | "driven", label: string) => (
    <>
      <label className="bc-field-label" htmlFor={`bc-drive-${which}`}>
        {label}
      </label>
      <select id={`bc-drive-${which}`} className="bc-select" value={p[which]} onChange={(e) => set({ [which]: e.target.value })}>
        {moving.map((j) => (
          <option key={j.id} value={j.id}>
            {j.name}
          </option>
        ))}
      </select>
    </>
  );
  return (
    <Dialog
      open
      modal
      title={editing ? `Edit ${editing.name}` : "Drive link"}
      icon="gear"
      onCancel={onCancel}
      width={420}
      footer={
        <>
          <Button kind="cancel" label="Cancel" onClick={onCancel} />
          <Button kind="done" label={editing ? "Done" : "Add drive"} disabled={!!preview.error} onClick={() => onDone(p)} />
        </>
      }
    >
      <div className="bc-drive">
        {pick("driver", "Driver")}
        {pick("driven", "Driven")}
        <span className="bc-field-label" id="bc-drive-kind">
          Through
        </span>
        <span role="group" aria-labelledby="bc-drive-kind" className="bc-segmented">
          {DRIVE_KINDS.map((k) => (
            <Button key={k.id} label={k.label} title={k.title} on={p.kind === k.id} onClick={() => set({ kind: k.id as DriveKind })} />
          ))}
        </span>
        {typed && (
          <>
            <NumberField label="Ratio" value={p.ratio} precision={4} onCommit={(v) => set({ ratio: v })} />
            {p.kind !== "custom" && <p className="bc-note">The links don't both have the gears for this, so the ratio you type is used.</p>}
          </>
        )}
        <label className="bc-check">
          <input type="checkbox" checked={!!p.reverse} onChange={(e) => set({ reverse: e.target.checked || undefined })} />
          <span>Turn the other way</span>
        </label>
        <p className="bc-note" role="status">
          {status}
        </p>
      </div>
    </Dialog>
  );
}

/**
 * A motion link: pick the lead joint and tick the joints that move with it, so all the wheels of a rover turn together.
 * Each ticked joint turns the same way round in the model as the lead (wheels on the far side included) unless you tick
 * Other way. Built as one mimic per joint, so posing, Play, the clash sweep and URDF all follow.
 */
function LinkJointsDialog({ doc, editing, lead: first, onDone, onCancel }: DriveDialogProps) {
  const { joints, drives } = useMemo(() => build(doc), [doc]);
  // Joints another step already drives can't join; the ones this link drives can.
  const free = joints.filter((j) => movable(j) && !drives.some((d) => d.driven === j.id && d.id !== editing?.id));
  const [lead, setLead] = useState(() => editing?.driver ?? (first && free.some((j) => j.id === first) ? first : free[0]?.id) ?? "");
  const [ticked, setTicked] = useState<string[]>(() => (editing ? [editing.driven, ...(editing.more ?? [])] : []));
  const [against, setAgainst] = useState<string[]>(() => editing?.against ?? []);
  const leadJoint = joints.find((j) => j.id === lead);
  const turns = (k?: string) => k === "revolute" || k === "continuous";
  const others = free.filter((j) => j.id !== lead && turns(j.kind) === turns(leadJoint?.kind));
  const chosen = ticked.filter((id) => others.some((j) => j.id === id));
  const params: DriveParams | null = chosen.length
    ? { kind: "together", driver: lead, driven: chosen[0]!, ratio: 1, more: chosen.slice(1), against: against.filter((id) => chosen.includes(id)) }
    : null;
  const error = useMemo(() => {
    if (!params) return null;
    const next = editing ? updateDrive(doc, editing.id, params) : addDrive(doc, params, PREVIEW);
    return build(next).failed.get(editing?.id ?? PREVIEW) ?? null;
  }, [doc, editing, params?.driver, params?.driven, params?.more?.join(), params?.against?.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list.filter((x) => x !== id), id] : list.filter((x) => x !== id));
  const name = (id: string) => joints.find((j) => j.id === id)?.name ?? "the joint";
  const status = error
    ? error
    : chosen.length
      ? `${chosen.length === 1 ? name(chosen[0]!) : `${chosen.length} joints`} ${chosen.length === 1 ? "moves" : "move"} with ${name(lead)}`
      : "Tick the joints that move with it";
  return (
    <Dialog
      open
      modal
      title={editing ? `Edit ${editing.name}` : "Link joints"}
      icon="link"
      onCancel={onCancel}
      width={420}
      footer={
        <>
          <Button kind="cancel" label="Cancel" onClick={onCancel} />
          <Button kind="done" label={editing ? "Done" : "Link joints"} disabled={!params || !!error} onClick={() => params && onDone(params)} />
        </>
      }
    >
      <div className="bc-drive">
        <label className="bc-field-label" htmlFor="bc-link-lead">
          Lead joint
        </label>
        <select id="bc-link-lead" className="bc-select" value={lead} onChange={(e) => setLead(e.target.value)}>
          {free.map((j) => (
            <option key={j.id} value={j.id}>
              {j.name}
            </option>
          ))}
        </select>
        <fieldset className="bc-link-joints">
          <legend className="bc-field-label">Moves with it</legend>
          {others.length === 0 && <p className="bc-note">No other joint can move with this one.</p>}
          {others.map((j) => {
            const on = ticked.includes(j.id);
            return (
              <div key={j.id} className="bc-link-row">
                <label className="bc-check">
                  <input type="checkbox" checked={on} onChange={(e) => setTicked((t) => toggle(t, j.id, e.target.checked))} />
                  <span>{j.name}</span>
                </label>
                <label className="bc-check">
                  <input
                    type="checkbox"
                    aria-label={`${j.name} turns the other way`}
                    disabled={!on}
                    checked={on && against.includes(j.id)}
                    onChange={(e) => setAgainst((a) => toggle(a, j.id, e.target.checked))}
                  />
                  <span aria-hidden="true">Other way</span>
                </label>
              </div>
            );
          })}
        </fieldset>
        <p className="bc-note">Joints on the far side turn to go the same way as the lead. Tick Other way to turn one back.</p>
        <p className="bc-note" role="status">
          {status}
        </p>
      </div>
    </Dialog>
  );
}
