import { describe, expect, it } from "vitest";
import { drawRectangle } from "@bettercad/sketch";
import { addExtrude, addLink, addPart, addSketch, changeParts, makeComponent, moveInto, newDoc, stampComponent, updateSketch, type ModelDoc } from "./document";
import { componentSteps } from "./componentSteps";

const xy = { kind: "world", plane: "XY", offset: 0 } as const;
/** Stamps what `edit` adds as made in `component`, as the editor does while a component is active. */
const inComp = (doc: ModelDoc, component: string, edit: (d: ModelDoc) => ModelDoc) => stampComponent(doc, edit(doc), component);

describe("componentSteps", () => {
  it("lists a component's sketch and extrude, and nothing else", () => {
    let d = addPart(newDoc(), "box", "other");
    d = addLink(d, [], "C");
    d = inComp(d, "C", (x) => addSketch(x, xy, "s"));
    d = inComp(d, "C", (x) => addExtrude(x, { sketch: "s", seeds: [[5, 5]], distance: 10, direction: "one", operation: "new" }, "e", "body"));
    d = addPart(d, "box", "more");
    expect(componentSteps(d, "C")).toEqual(["C", "s", "e"]);
  });

  it("takes in the steps that made and changed bodies the component was made from, and their sketch", () => {
    let d = addSketch(newDoc(), xy, "s");
    d = updateSketch(d, "s", (s) => drawRectangle(s, [0, 0], [10, 10]).sketch);
    d = addExtrude(d, { sketch: "s", seeds: [[5, 5]], distance: 10, direction: "one", operation: "new" }, "e", "body");
    d = addPart(d, "box", "b");
    d = changeParts(d, ["body"], "position", { x: 5 });
    const moved = d.features.at(-1)!.id;
    d = makeComponent(d, ["body"], "C");
    expect(componentSteps(d, "C")).toEqual(["s", "e", moved, "C"]);
  });

  it("includes nested components and what was dragged into it", () => {
    let d = addLink(newDoc(), [], "C");
    d = addLink(d, [], "D", undefined, "C");
    d = inComp(d, "D", (x) => addSketch(x, xy, "s"));
    d = addSketch(d, xy, "t");
    d = moveInto(d, ["t"], "C");
    d = addSketch(d, xy, "u");
    expect(componentSteps(d, "C")).toEqual(["C", "D", "s", "t"]);
    expect(componentSteps(d, "D")).toEqual(["D", "s"]);
  });
});
