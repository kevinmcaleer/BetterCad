import { describe, expect, it } from "vitest";
import { createStore } from "./store";
import { LIMIT } from "./history";
import { addPart, changeParts, newDoc, type ModelDoc } from "./document";
import { loadBcad, saveBcad } from "@bettercad/kernel/bcad";

/** A model with fifty steps: fifty boxes. */
function fifty(): ModelDoc {
  let d = newDoc();
  for (let i = 0; i < 50; i++) d = addPart(d, "box", `b${i}`);
  return d;
}

/**
 * Roughly how much memory a set of revisions holds: every object and array counted once however many revisions share
 * it (structural sharing), at 40 bytes plus 8 a field, and strings at 2 bytes a character.
 */
function retained(revisions: unknown[]): number {
  const seen = new Set<object>();
  let bytes = 0;
  const walk = (v: unknown) => {
    if (typeof v === "string") bytes += 2 * v.length;
    else if (typeof v === "number" || typeof v === "boolean") bytes += 8;
    else if (v && typeof v === "object") {
      if (seen.has(v)) return;
      seen.add(v);
      const vals = Object.values(v);
      bytes += 40 + 8 * vals.length;
      vals.forEach(walk);
    }
  };
  revisions.forEach(walk);
  return bytes;
}

describe("document revisions (#45)", () => {
  it("undo then redo gives back the very same revision", () => {
    const s = createStore(fifty());
    const before = s.get();
    s.edit((d) => changeParts(d, ["b3"], "position", { x: 12 }), "Move");
    const after = s.get();
    s.undo();
    expect(s.get()).toBe(before);
    s.redo();
    expect(s.get()).toBe(after);
    // Unchanged steps are shared between the two revisions, not copied.
    expect(after.features[0]).toBe(before.features[0]);
  });

  it("keeps 1,000 edits of a 50-step model well under 20 MB", () => {
    const s = createStore(fifty());
    for (let i = 0; i < 1000; i++) s.edit((d) => changeParts(d, [`b${i % 50}`], "position", { x: i }), "Move");
    const h = s.history();
    const revisions = [...h.past.map((p) => p.state), h.present];
    expect(revisions.length).toBe(LIMIT + 1);
    expect(retained(revisions)).toBeLessThan(20 * 1024 * 1024);
  });

  it("saves and opens a model without losing anything", () => {
    let d = fifty();
    d = changeParts(d, ["b7"], "position", { x: 3.25, y: -1 });
    const back = loadBcad(saveBcad(d));
    expect("doc" in back && back.doc).toEqual(d);
  });
});
