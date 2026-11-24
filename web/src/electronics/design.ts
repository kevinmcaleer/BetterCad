import { emptyDesign, type ElectronicsDesign } from "@bettercad/electronics";
import { addBoard } from "@bettercad/kernel/board";
import type { ModelDoc } from "@bettercad/kernel/document";

/** Wraps a design change as a model change. A model with no electronics yet gets an empty design first. */
export const onDesign =
  (change: (d: ElectronicsDesign) => ElectronicsDesign) =>
  (doc: ModelDoc): ModelDoc => {
    const before = doc.electronics ?? emptyDesign();
    const after = change(before);
    if (after === before && doc.electronics) return doc;
    const next = { ...doc, electronics: after };
    // A board that has just been made goes into the model too, as its Board step (#650), in the same undo step.
    return !before.board && after.board ? addBoard(next) : next;
  };
