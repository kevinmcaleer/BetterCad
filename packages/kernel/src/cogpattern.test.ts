import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";
import { BcadError, loadBcad } from "./bcad";

/** The cog chamfer model (see cogstud.test.ts) with its pattern copying the chamfer too (#426). Its own file, as it is slow. */
const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures", "425-chamfer-cog-stud", "model.bcad");

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

describe("the chamfered cog stud model, patterned with its chamfer", () => {
  it("copies the chamfer round the wheel with the cog when the pattern picks both (#426)", async () => {
    const loaded = loadBcad(readFileSync(FILE, "utf8"));
    if (loaded instanceof BcadError) throw new Error(loaded.message);
    const doc = loaded.doc;
    const chamfer = doc.features.find((f) => f.name === "Chamfer 2")!;
    // One builder, so the bodies the three builds share are made once.
    const builder = new ModelBuilder(oc);
    const wheel = async (features: string[], suppress = false) => {
      // Let the test runner's messages through between builds: each one holds the thread for seconds.
      await new Promise((r) => setTimeout(r, 0));
      const d = {
        ...doc,
        features: doc.features.map((f) =>
          f.name === "Pattern 2" && f.type === "pattern" ? { ...f, features } : suppress && f.id === chamfer.id ? { ...f, suppressed: true } : f,
        ),
      };
      const r = builder.build(d);
      expect(r.failed).toEqual([]);
      const b = r.bodies.find((x) => x.id === "pmw8gysszf67")!;
      expect(b.measure.solids).toBe(1);
      return b.measure;
    };
    const cog = doc.features.find((f) => f.name === "Cog")!.id;
    const bare = await wheel([cog], true);
    const one = await wheel([cog]);
    const all = await wheel([cog, chamfer.id]);
    const cut = bare.volume - one.volume;
    expect(cut).toBeGreaterThan(0.01);
    // Every one of the 8 cogs loses the same chamfer, and gains the same faces.
    expect(bare.volume - all.volume).toBeCloseTo(8 * cut, 2);
    expect(all.faces - bare.faces).toBe(8 * (one.faces - bare.faces));
  }, 120_000);
});
