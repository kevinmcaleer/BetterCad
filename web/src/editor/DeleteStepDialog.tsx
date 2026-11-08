import { Button, Dialog } from "@bettercad/ui";
import { dependents, usedByText, type ModelDoc } from "../state/document";
import { formatCombo } from "../state/commands";

/** "1 later step rebuilds" or "5 later steps rebuild": the count, then the verb that agrees with it. */
export function laterText(n: number, verb?: [one: string, many: string]): string {
  const text = `${n} later ${n === 1 ? "step" : "steps"}`;
  return verb ? `${text} ${n === 1 ? verb[0] : verb[1]}` : text;
}

const REBUILD: [string, string] = ["rebuilds", "rebuild"];

/** How many steps come after a step on the timeline. */
export function stepsAfter(doc: ModelDoc, id: string): number {
  const i = doc.features.findIndex((f) => f.id === id);
  return i < 0 ? 0 : doc.features.length - i - 1;
}

/**
 * What the timeline warns about while you change an earlier step, or add one while it's rolled back. Null when
 * nothing comes after the change.
 */
export function earlierWarning(doc: ModelDoc, at: number, editingId: string | null): string | null {
  const n = doc.features.length;
  const f = editingId ? doc.features.find((x) => x.id === editingId) : undefined;
  if (f) {
    const later = stepsAfter(doc, f.id);
    return later ? `You're changing ${f.name}. ${laterText(later, REBUILD)} after it, and any that use its faces or edges may break.` : null;
  }
  if (at < n) return `Rolled back. What you add goes before ${laterText(n - at)}, which may break.`;
  return null;
}

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
