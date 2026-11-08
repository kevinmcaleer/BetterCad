import { Button, Dialog } from "@bettercad/ui";
import { dependents, usedByText, type ModelDoc } from "../state/document";
import { formatCombo } from "../state/commands";
import { laterText, stepsAfter } from "./DeleteStepDialog";

export interface DeleteStepDialogProps {
  doc: ModelDoc;
  id: string;
  onCancel: () => void;
  /** Deletes the step, and with `all` every step that needs it. */
  onDelete: (all: boolean) => void;
}

/** Asks before a step that isn't the last one goes, since everything after it rebuilds without it. */
export function DeleteStepDialog({ doc, id, onCancel, onDelete }: DeleteStepDialogProps) {
  const f = doc.features.find((x) => x.id === id);
  const deps = dependents(doc, id);
  const later = stepsAfter(doc, id);
  const undo = formatCombo("mod+z");
  return (
    <Dialog
      open
      title={`Delete ${f?.name ?? "this step"}`}
      icon="trash"
      onCancel={onCancel}
      footer={
        <>
          <Button kind="cancel" label="Cancel" onClick={onCancel} />
          {deps.length ? (
            <>
              <Button label="Delete just this one" onClick={() => onDelete(false)} />
              <Button variant="danger" label={`Delete all ${deps.length + 1}`} onClick={() => onDelete(true)} />
            </>
          ) : (
            <Button variant="danger" label="Delete" onClick={() => onDelete(false)} />
          )}
        </>
      }
    >
      {deps.length ? (
        <>
          <p>{usedByText(doc, id)}.</p>
          <p className="bc-note">Delete them too, or keep them and fix them afterwards. {undo} undoes either.</p>
        </>
      ) : (
        <>
          <p>
            {laterText(later, ["comes", "come"])} after {f?.name ?? "it"}. {later === 1 ? "It rebuilds" : "They rebuild"} without it, and any that use its faces
            or edges may break.
          </p>
          <p className="bc-note">{undo} brings it back.</p>
        </>
      )}
    </Dialog>
  );
}
