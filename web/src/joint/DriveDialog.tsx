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
  onDone: (params: DriveParams) => void;
  onCancel: () => void;
}

const PREVIEW = "drive-preview";

/**
 * A drive link (#194): which joint drives which, through gears, a belt, a rack or a typed ratio. The ratio is worked out
 * from the teeth when both links have the gears, and shown in words as you choose.
 */
export function DriveDialog({ doc, editing, onDone, onCancel }: DriveDialogProps) {
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
