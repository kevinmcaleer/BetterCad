import { describe, expect, it } from "vitest";
import { drawRectangle, newSketch } from "@bettercad/sketch";
import { addExtrude, addPart, newDoc, type ModelDoc } from "../state/document";
import { TOUR_FINISH, TOUR_STEPS, nextStep, type TourState } from "./tour";

const state = (doc: ModelDoc, more: Partial<TourState> = {}): TourState => ({ doc, looked: false, sketching: false, exported: false, ...more });

function sketched(): ModelDoc {
  const doc = newDoc();
  const s = drawRectangle(newSketch({ kind: "world", plane: "XY", offset: 0 }, "Sketch 1", "sk1"), [0, 0], [40, 30]).sketch;
  return { ...doc, features: [{ id: "s1", type: "sketch", name: "Sketch 1", sketch: s }] };
}

describe("tour", () => {
  it("has five steps in the brand book's voice", () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(["look", "sketch", "extrude", "fillet", "export"]);
    for (const s of [...TOUR_STEPS.flatMap((x) => [x.title, x.body]), TOUR_FINISH.title, TOUR_FINISH.body]) {
      expect(s).not.toMatch(/!/);
      expect(s).not.toMatch(/\d(mm|°)/);
    }
    expect(TOUR_FINISH.title).toBe("That's a printable part. Open it in your slicer.");
  });

  it("moves on as each step is done, and not before", () => {
    expect(nextStep(0, state(newDoc()))).toBe(0);
    expect(nextStep(0, state(newDoc(), { looked: true }))).toBe(1);
    // A box is not a sketch; an open sketch is not finished.
    expect(nextStep(1, state(addPart(newDoc(), "box")))).toBe(1);
    expect(nextStep(1, state(sketched(), { sketching: true }))).toBe(1);
    const doc = sketched();
    expect(nextStep(1, state(doc))).toBe(2);
    const extruded = addExtrude(doc, { sketch: "s1", seeds: [[20, 15]], distance: 10, direction: "one", operation: "new" });
    expect(nextStep(1, state(extruded))).toBe(3);
    expect(nextStep(4, state(extruded, { exported: true }))).toBe(5);
  });
});
