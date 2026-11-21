import { Button, Dialog } from "@bettercad/ui";
import { dependents, usedByText, type ModelDoc } from "../state/document";
import { formatCombo } from "../state/commands";
import { modelRemoval } from "@bettercad/kernel/insert-model";
import { laterText, stepsAfter } from "./DeleteStepDialog";

export interface DeleteStepDialogProps {
  doc: ModelDoc;
  id: string;
  onCancel: () => void;
  /** Deletes the step, and with `all` every step that needs it. */
  onDelete: (all: boolean) => void;
}

const list = (names: string[]) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** Asks before a step that isn't the last one goes, since everything after it rebuilds without it. */
export function DeleteStepDialog({ doc, id, onCancel, onDelete }: DeleteStepDialogProps) {
  const f = doc.features.find((x) => x.id === id);
  // An inserted model's joints always go with it (#480), so only the steps that use its bodies are a choice.
  const model = f?.type === "model";
  const deps = model ? modelRemoval(doc, id).uses : dependents(doc, id);
  const later = stepsAfter(doc, id);
  const undo = formatCombo("mod+z");
  return (
    <Dialog
      open
      title={`${model ? "Remove" : "Delete"} ${f?.name ?? "this step"}`}
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
          <p>{model ? `${f!.name} is used by ${list(deps.map((d) => d.name))}` : usedByText(doc, id)}.</p>
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
