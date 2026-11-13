import { describe, expect, it } from "vitest";
import { drawRectangle } from "@bettercad/sketch";
import { addExtrude, addLink, addPart, addSketch, changeParts, makeComponent, moveInto, newDoc, stampComponent, updateSketch, type ModelDoc } from "./document";
import { bodySteps, componentSteps, stepComponents } from "./componentSteps";

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

describe("bodySteps", () => {
  it("lists the steps that make or change a body, and the sketch its extrude uses", () => {
    let d = addSketch(newDoc(), xy, "s");
    d = updateSketch(d, "s", (x) => drawRectangle(x, [0, 0], [10, 10]).sketch);
    d = addExtrude(d, { sketch: "s", seeds: [[5, 5]], distance: 10, direction: "one", operation: "new" }, "e", "body");
    d = addPart(d, "box", "b");
    d = changeParts(d, ["body"], "position", { x: 5 });
    const moved = d.features.at(-1)!.id;
    d = changeParts(d, ["b"], "size", { x: 5 });
    expect(bodySteps(d, ["body"])).toEqual(["s", "e", moved]);
    expect(bodySteps(d, ["b"])).toEqual([d.features[2]!.id, d.features.at(-1)!.id]);
    expect(bodySteps(d, [])).toEqual([]);
  });
});

describe("stepComponents", () => {
  it("gives each component's steps that component, and leaves the model's own steps out", () => {
    let d = addPart(newDoc(), "box", "loose");
    d = addLink(d, [], "C");
    d = inComp(d, "C", (x) => addSketch(x, xy, "s"));
    d = updateSketch(d, "s", (x) => drawRectangle(x, [0, 0], [10, 10]).sketch);
    d = inComp(d, "C", (x) => addExtrude(x, { sketch: "s", seeds: [[5, 5]], distance: 10, direction: "one", operation: "new" }, "e", "body"));
    d = changeParts(d, ["body"], "position", { x: 5 });
    const moved = d.features.at(-1)!.id;
    d = addPart(d, "box", "b");
    d = makeComponent(d, ["b"], "D");
    const { of, cycle, names } = stepComponents(d);
    expect([...of]).toEqual([
      ["C", "C"],
      ["s", "C"],
      ["e", "C"],
      [moved, "C"],
      [d.features.at(-2)!.id, "D"],
      ["D", "D"],
    ]);
    // In the colour cycle's order: the loose box first, then each component.
    expect(cycle).toEqual(["loose", "C", "D"]);
    expect(names.get("D")).toBeTruthy();
  });
});
