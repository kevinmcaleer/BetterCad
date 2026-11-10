import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addLink,
  makeComponent,
  addSketch,
  stampComponent,
  addConstruct,
  moveInto,
  linkTransforms,
  addPart,
  addPattern,
  build,
  changeParts,
  dependsOn,
  duplicateParts,
  featureSummary,
  newDoc,
  removeFeature,
  removeParts,
  type ModelDoc,
} from "./document";
import { BcadError, loadBcad, saveBcad } from "./bcad";

/** Three boxes, a, b and c. */
const three = (): ModelDoc => addPart(addPart(addPart(newDoc(), "box", "a"), "box", "b"), "box", "c");
const linkOf = (doc: ModelDoc, id: string) => build(doc).parts.find((p) => p.id === id)?.link;

describe("links (#171)", () => {
  it("names bodies as one link, leaving the rest in the base link", () => {
    const doc = addLink(three(), ["a", "b"], "L1");
    expect(doc.features.at(-1)).toMatchObject({ type: "link", name: "Component 1", parts: ["a", "b"] });
    expect(build(doc).links).toEqual([{ id: "L1", name: "Component 1", parts: ["a", "b"] }]);
    expect(linkOf(doc, "c")).toBeUndefined();
    // The bodies stay separate: still three parts.
    expect(build(doc).parts).toHaveLength(3);
  });

  it("makes a component named after its body when the name is free, taking it from where it was dragged", () => {
    const moved = moveInto(three(), ["a"], null);
    const doc = makeComponent(moved, ["a"], "L1", undefined, undefined, "Wheel");
    expect(doc.features.at(-1)).toMatchObject({ type: "link", name: "Wheel", parts: ["a"] });
    expect(doc.owners).toEqual({});
    expect(linkOf(doc, "a")).toBe("L1");
    // A name another component has falls back to the next Component number.
    expect(makeComponent(doc, ["b"], "L2", undefined, undefined, "Wheel").features.at(-1)).toMatchObject({ name: "Component 1" });
  });

  it("numbers new links and moves a body from an earlier link to a later one", () => {
    let doc = addLink(three(), ["a", "b"], "L1");
    doc = addLink(doc, ["b", "c"], "L2");
    expect(doc.features.at(-1)!.name).toBe("Component 2");
    expect(build(doc).links).toEqual([
      { id: "L1", name: "Component 1", parts: ["a"] },
      { id: "L2", name: "Component 2", parts: ["b", "c"] },
    ]);
  });

  it("knows membership at any rollback point", () => {
    let doc = addLink(three(), ["a"], "L1");
    doc = addLink(doc, ["a"], "L2");
    expect(build(doc, doc.features.length - 1).links.map((l) => l.id)).toEqual(["L1"]);
    expect(build(doc).links.map((l) => l.id)).toEqual(["L2"]);
    expect(build(doc, 3).links).toEqual([]);
  });

  it("keeps a moved body in its link", () => {
    let doc = addLink(three(), ["a"], "L1");
    doc = changeParts(doc, ["a"], "position", { x: 40 });
    expect(linkOf(doc, "a")).toBe("L1");
  });

  it("puts copies in their original's link, duplicated or patterned", () => {
    let doc = addLink(three(), ["a"], "L1");
    doc = duplicateParts(doc, ["a", "c"], ["a2", "c2"]);
    expect(linkOf(doc, "a2")).toBe("L1");
    expect(linkOf(doc, "c2")).toBeUndefined();
    doc = addPattern(doc, { parts: ["a"], kind: "mirror" }, "m");
    const mirrored = build(doc).parts.filter((p) => p.id.startsWith("m"));
    expect(mirrored.length).toBeGreaterThan(0);
    expect(mirrored.every((p) => p.link === "L1")).toBe(true);
  });

  it("takes a deleted body out of its link, and drops a link left empty", () => {
    let doc = addLink(three(), ["a", "b"], "L1");
    doc = removeParts(doc, ["a"]);
    expect(build(doc).links).toEqual([{ id: "L1", name: "Component 1", parts: ["b"] }]);
    doc = removeParts(doc, ["b"]);
    expect(build(doc).links).toEqual([]);
  });

  it("fails plainly when every body it links is gone, and suppressing it puts them back in base", () => {
    let doc = addLink(three(), ["a"], "L1");
    const made = doc.features[0]!.id;
    expect(dependsOn(doc, "L1")).toEqual([made]);
    doc = removeFeature(doc, made);
    expect(build(doc).failed.get("L1")).toBe("The bodies it links are gone");
    const off = { ...addLink(three(), ["a"], "L1") };
    off.features = off.features.map((f) => (f.id === "L1" ? { ...f, suppressed: true } : f));
    expect(build(off).links).toEqual([]);
  });

  it("summarises the step", () => {
    const doc = addLink(three(), ["a", "b"], "L1");
    expect(featureSummary(doc, doc.features.at(-1)!)).toBe("2 parts, one rigid component");
  });

  it("round-trips through .bcad, and a schema 1 file opens with every body in base", () => {
    const doc = addLink(three(), ["a"], "L1");
    const back = loadBcad(saveBcad(doc));
    if (back instanceof BcadError) throw back;
    expect(back.warning).toBeUndefined();
    expect(build(back.doc).links).toEqual([{ id: "L1", name: "Component 1", parts: ["a"] }]);
    const old = loadBcad(readFileSync(join(__dirname, "testdata", "bcad", "schema1.bcad"), "utf8"));
    if (old instanceof BcadError) throw old;
    expect(old.meta.schema).toBe(2);
    expect(build(old.doc).links).toEqual([]);
    expect(build(old.doc).parts.every((p) => p.link === undefined)).toBe(true);
  });
});

describe("components (#171)", () => {
  /** Adds a box the way the editor does while `component` is active. */
  const addIn = (doc: ModelDoc, id: string, component: string | null) => stampComponent(doc, addPart(doc, "box", id), component);

  it("starts empty, nests inside another, and lists both", () => {
    let doc = addLink(newDoc(), [], "C1");
    doc = addLink(doc, [], "C2", undefined, "C1");
    const b = build(doc);
    expect(b.failed.size).toBe(0);
    expect(b.components).toEqual([
      { id: "C1", name: "Component 1", parts: [] },
      { id: "C2", name: "Component 2", parts: [], parent: "C1" },
    ]);
    // Empty components aren't URDF links.
    expect(b.links).toEqual([]);
    expect(featureSummary(doc, doc.features[0]!)).toBe("A component to work in");
  });

  it("puts bodies made while a component is active into it, and others into the model", () => {
    let doc = addLink(newDoc(), [], "C1");
    doc = addIn(doc, "a", "C1");
    doc = addIn(doc, "b", null);
    expect(doc.features.find((f) => f.id !== "C1" && f.type === "add" && f.part.id === "a")).toMatchObject({ component: "C1" });
    expect(linkOf(doc, "a")).toBe("C1");
    expect(linkOf(doc, "b")).toBeUndefined();
    expect(build(doc).links).toEqual([{ id: "C1", name: "Component 1", parts: ["a"] }]);
  });

  it("files a sketch made while a component is active under it", () => {
    const doc = addLink(newDoc(), [], "C1");
    const next = stampComponent(doc, addSketch(doc, { kind: "world", plane: "XY", offset: 0 }, "s1"), "C1");
    expect(build(next).sketches[0]).toMatchObject({ id: "s1", component: "C1" });
    // Nothing new, nothing stamped; a joint never is.
    expect(stampComponent(next, next, "C1")).toBe(next);
  });

  it("files a construction plane made while a component is active under it", () => {
    const doc = addLink(newDoc(), [], "C1");
    const next = stampComponent(doc, addConstruct(doc, { kind: "offset", refs: [{ origin: "XY" }], value: 5 }, "p1"), "C1");
    expect(build(next).construct[0]).toMatchObject({ id: "p1", component: "C1" });
  });

  it("gives a deleted component's bodies back to the model", () => {
    let doc = addLink(newDoc(), [], "C1");
    doc = addIn(doc, "a", "C1");
    doc = removeFeature(doc, "C1");
    expect(linkOf(doc, "a")).toBeUndefined();
  });

  it("hangs a URDF link from its nearest enclosing component with bodies", () => {
    let doc = addLink(newDoc(), [], "C1");
    doc = addIn(doc, "a", "C1");
    doc = addLink(doc, [], "C2", undefined, "C1");
    doc = addLink(doc, [], "C3", undefined, "C2");
    doc = addIn(doc, "c", "C3");
    expect(build(doc).links).toEqual([
      { id: "C1", name: "Component 1", parts: ["a"] },
      { id: "C3", name: "Component 3", parts: ["c"], parent: "C1" },
    ]);
  });

  it("carries a nested component with no joint along with its jointed parent", () => {
    const hinge = {
      id: "J",
      kind: "revolute" as const,
      child: "C1",
      parent: null,
      origin: [0, 0, 0] as [number, number, number],
      axis: [0, 0, 1] as [number, number, number],
      lower: -90,
      upper: 90,
    };
    const m = linkTransforms([hinge], { J: 90 }, [{ id: "C1" }, { id: "C2", parent: "C1" }]);
    expect(m.get("C2")).toEqual(m.get("C1"));
    expect(m.get("C2")![0]).toBeCloseTo(0);
  });
});

describe("moving into components (#334)", () => {
  const two = () => {
    let doc = addLink(newDoc(), [], "C1");
    doc = addLink(doc, [], "C2", undefined, "C1");
    doc = addPart(doc, "box", "a");
    return addSketch(doc, { kind: "world", plane: "XY", offset: 0 }, "s1");
  };

  it("moves a body, a sketch and a component, and back to the model", () => {
    let doc = moveInto(two(), ["a", "s1"], "C2");
    let b = build(doc);
    expect(linkOf(doc, "a")).toBe("C2");
    expect(b.sketches[0]).toMatchObject({ component: "C2" });
    doc = moveInto(doc, ["C2"], null);
    expect(build(doc).components.find((c) => c.id === "C2")!.parent).toBeUndefined();
    doc = moveInto(doc, ["a"], null);
    b = build(doc);
    expect(linkOf(doc, "a")).toBeUndefined();
    expect(b.links).toEqual([]);
  });

  it("never puts a component inside itself or one of its own", () => {
    const doc = moveInto(two(), ["C1"], "C2");
    expect(doc.owners?.C1).toBeUndefined();
    expect(build(doc).components.find((c) => c.id === "C1")!.parent).toBeUndefined();
  });

  it("wins over the component a body was made in", () => {
    let doc = addLink(newDoc(), [], "C1");
    doc = stampComponent(doc, addPart(doc, "box", "a"), "C1");
    doc = moveInto(doc, ["a"], null);
    expect(linkOf(doc, "a")).toBeUndefined();
  });
});
