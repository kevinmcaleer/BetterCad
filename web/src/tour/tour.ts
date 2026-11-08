import { profiles } from "@bettercad/sketch";
import type { ModelDoc } from "../state/document";

/**
 * The first-run tour (#98): five steps from looking around to an exported STL, in the brand book's voice. The copy
 * lives here, word for word, so the Learn course (#12) can reuse it.
 */
export const TOUR_KEY = "bettercad.tourDone";

/** What the editor tells the tour, to know when a step is done. */
export interface TourState {
  doc: ModelDoc;
  /** The camera moved since the step began. */
  looked: boolean;
  /** A sketch is open for editing. */
  sketching: boolean;
  /** An export finished since the step began. */
  exported: boolean;
}

/** Where a step's card sits: by a toolbar button (by its label), or over the 3D view. */
export type TourAnchor = { kind: "view" } | { kind: "button"; label: string };

export interface TourStep {
  id: "look" | "sketch" | "extrude" | "fillet" | "export";
  title: string;
  body: string;
  anchor: TourAnchor;
  done: (s: TourState) => boolean;
}

const has = (doc: ModelDoc, type: string) => doc.features.some((f) => f.type === type && !f.suppressed);

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "look",
    title: "Look around",
    body: "Drag to look around. Right-drag or drag two fingers to pan, scroll or pinch to zoom.",
    anchor: { kind: "view" },
    done: (s) => s.looked,
  },
  {
    id: "sketch",
    title: "Sketch a rectangle",
    body: "Press Sketch (K) and click the ground. Draw a rectangle with R, then press Enter to finish the sketch.",
    anchor: { kind: "button", label: "Sketch" },
    done: (s) => !s.sketching && s.doc.features.some((f) => f.type === "sketch" && !f.suppressed && profiles(f.sketch).profiles.length > 0),
  },
  {
    id: "extrude",
    title: "Extrude it 10 mm",
    body: "Press Extrude (E), click inside the rectangle, type 10 and press Enter.",
    anchor: { kind: "button", label: "Extrude" },
    done: (s) => has(s.doc, "extrude"),
  },
  {
    id: "fillet",
    title: "Round the top edges",
    body: "Press Fillet (G), click the top edges, type a radius like 2 mm and press Enter.",
    anchor: { kind: "button", label: "Fillet" },
    done: (s) => has(s.doc, "fillet"),
  },
  {
    id: "export",
    title: "Export an STL",
    body: "Press Ctrl+E, or Export from the arrow beside Save, and save the STL.",
    anchor: { kind: "button", label: "Save" },
    done: (s) => s.exported,
  },
];

export const TOUR_FINISH = {
  title: "That's a printable part. Open it in your slicer.",
  body: "Next, pull a sample apart to see how it's made.",
};

/** The first step not yet done, from `from` on. Steps are done in order: a later one done early still waits. */
export function nextStep(from: number, s: TourState): number {
  let i = from;
  while (i < TOUR_STEPS.length && TOUR_STEPS[i]!.done(s)) i++;
  return i;
}

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
export const tourDone = () => storage()?.getItem(TOUR_KEY) === "1";
export const markTourDone = () => storage()?.setItem(TOUR_KEY, "1");
