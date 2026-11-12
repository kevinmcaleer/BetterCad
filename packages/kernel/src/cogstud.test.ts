import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";
import { BcadError, loadBcad } from "./bcad";

/**
 * A real model that broke twice (#425): a 5.5 mm cog joined flat onto an octagonal wheel, chamfered 1 mm on its top
 * edge before a pattern copies it round the wheel. The chamfer must build at that point in the timeline, and every
 * patterned cog must end up part of the wheel, not a loose piece touching it. Runs on every PR, not just nightly.
 */
const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures", "425-chamfer-cog-stud", "model.bcad");

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

describe("the chamfered cog stud model", () => {
  it("builds every step, with the chamfer before the pattern, and each wheel in one piece", () => {
    const loaded = loadBcad(readFileSync(FILE, "utf8"));
    if (loaded instanceof BcadError) throw new Error(loaded.message);
    const doc = loaded.doc;
    const names = doc.features.map((f) => f.name);
    expect(names.indexOf("Chamfer 2")).toBeLessThan(names.indexOf("Pattern 2"));
    const r = new ModelBuilder(oc).build(doc);
    expect(r.failed).toEqual([]);
    expect(r.bodies.map((b) => b.measure.solids)).toEqual(r.bodies.map(() => 1));
  }, 60_000);

  it("builds the chamfer with the timeline rolled back to it", () => {
    const loaded = loadBcad(readFileSync(FILE, "utf8"));
    if (loaded instanceof BcadError) throw new Error(loaded.message);
    const doc = loaded.doc;
    const at = doc.features.findIndex((f) => f.name === "Chamfer 2") + 1;
    const r = new ModelBuilder(oc).build(doc, at);
    expect(r.failed).toEqual([]);
  }, 60_000);

  it("copies the chamfer round the wheel with the cog when the pattern picks both (#426)", () => {
    const loaded = loadBcad(readFileSync(FILE, "utf8"));
    if (loaded instanceof BcadError) throw new Error(loaded.message);
    const doc = loaded.doc;
    const chamfer = doc.features.find((f) => f.name === "Chamfer 2")!;
    const wheel = (features: string[], suppress = false) => {
      const d = {
        ...doc,
        features: doc.features.map((f) =>
          f.name === "Pattern 2" && f.type === "pattern" ? { ...f, features } : suppress && f.id === chamfer.id ? { ...f, suppressed: true } : f,
        ),
      };
      const r = new ModelBuilder(oc).build(d);
      expect(r.failed).toEqual([]);
      const b = r.bodies.find((x) => x.id === "pmw8gysszf67")!;
      expect(b.measure.solids).toBe(1);
      return b.measure;
    };
    const cog = doc.features.find((f) => f.name === "Cog")!.id;
    const bare = wheel([cog], true);
    const one = wheel([cog]);
    const all = wheel([cog, chamfer.id]);
    const cut = bare.volume - one.volume;
    expect(cut).toBeGreaterThan(0.01);
    // Every one of the 8 cogs loses the same chamfer, and gains the same faces.
    expect(bare.volume - all.volume).toBeCloseTo(8 * cut, 2);
    expect(all.faces - bare.faces).toBe(8 * (one.faces - bare.faces));
  }, 120_000);
});
