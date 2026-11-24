import { emptyDesign, type ElectronicsDesign } from "@bettercad/electronics";
import type { ModelDoc } from "@bettercad/kernel/document";

/** Wraps a design change as a model change. A model with no electronics yet gets an empty design first. */
export const onDesign =
  (change: (d: ElectronicsDesign) => ElectronicsDesign) =>
  (doc: ModelDoc): ModelDoc => {
    const before = doc.electronics ?? emptyDesign();
    const after = change(before);
    return after === before && doc.electronics ? doc : { ...doc, electronics: after };
  };
