import { emptyDesign, type ElectronicsDesign } from "@bettercad/electronics";
import { addBoard } from "@bettercad/kernel/board";
import type { ModelDoc } from "@bettercad/kernel/document";
import { withPartFiles } from "./partBlobs";

/** Wraps a design change as a model change. A model with no electronics yet gets an empty design first. */
export const onDesign =
  (change: (d: ElectronicsDesign) => ElectronicsDesign) =>
  (doc: ModelDoc): ModelDoc => {
    const before = doc.electronics ?? emptyDesign();
    const after = change(before);
    if (after === before && doc.electronics) return doc;
    // A part whose body is a STEP file (#628) brings the file with it, so the model builds without your library.
    const blobs = withPartFiles(doc.blobs, Object.values(after.defs));
    const next = { ...doc, electronics: after, ...(blobs ? { blobs } : {}) };
    // A board that has just been made goes into the model too, as its Board step (#650), in the same undo step.
    return !before.board && after.board ? addBoard(next) : next;
  };
