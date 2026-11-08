import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addLink,
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
    expect(doc.features.at(-1)).toMatchObject({ type: "link", name: "Link 1", parts: ["a", "b"] });
    expect(build(doc).links).toEqual([{ id: "L1", name: "Link 1", parts: ["a", "b"] }]);
    expect(linkOf(doc, "c")).toBeUndefined();
    // The bodies stay separate: still three parts.
    expect(build(doc).parts).toHaveLength(3);
  });

  it("numbers new links and moves a body from an earlier link to a later one", () => {
    let doc = addLink(three(), ["a", "b"], "L1");
    doc = addLink(doc, ["b", "c"], "L2");
    expect(doc.features.at(-1)!.name).toBe("Link 2");
    expect(build(doc).links).toEqual([
      { id: "L1", name: "Link 1", parts: ["a"] },
      { id: "L2", name: "Link 2", parts: ["b", "c"] },
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
    expect(build(doc).links).toEqual([{ id: "L1", name: "Link 1", parts: ["b"] }]);
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
    expect(featureSummary(doc, doc.features.at(-1)!)).toBe("2 parts, one rigid link");
  });

  it("round-trips through .bcad, and a schema 1 file opens with every body in base", () => {
    const doc = addLink(three(), ["a"], "L1");
    const back = loadBcad(saveBcad(doc));
    if (back instanceof BcadError) throw back;
    expect(back.warning).toBeUndefined();
    expect(build(back.doc).links).toEqual([{ id: "L1", name: "Link 1", parts: ["a"] }]);
    const old = loadBcad(readFileSync(join(__dirname, "testdata", "bcad", "schema1.bcad"), "utf8"));
    if (old instanceof BcadError) throw old;
    expect(old.meta.schema).toBe(2);
    expect(build(old.doc).links).toEqual([]);
    expect(build(old.doc).parts.every((p) => p.link === undefined)).toBe(true);
  });
});
