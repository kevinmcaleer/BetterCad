import { describe, expect, it } from "vitest";
import { applyProfile, matchesProfile, profileFromSettings, readProfile } from "./profiles";
import { addCombine, addPart, cutTool, newDoc, staleFits, updateFits } from "../document";

describe("printer profiles (#180)", () => {
  it("makes a profile from a model's settings, with every gap filled in", () => {
    const p = profileFromSettings("p1", "My A1", { printer: "bambu-a1", holeOffset: 0.3, fits: { sliding: 0.2 }, infill: 20 });
    expect(p).toEqual({ id: "p1", name: "My A1", printer: "bambu-a1", holeOffset: 0.3, fits: { press: 0.15, sliding: 0.2, loose: 0.4 } });
  });

  it("copies a profile into a model, keeping the infill, and knows when it's been changed", () => {
    const p = profileFromSettings("p1", "Big", { printer: "custom", custom: { x: 300, y: 300, z: 400 }, material: "petg" });
    const s = applyProfile({ printer: "prusa-mk4", infill: 25 }, p);
    expect(s).toMatchObject({ profile: "p1", printer: "custom", custom: { x: 300, y: 300, z: 400 }, material: "petg", infill: 25 });
    expect(matchesProfile(s, p)).toBe(true);
    expect(matchesProfile({ ...s, fits: { ...s.fits, loose: 0.5 } }, p)).toBe(false);
    expect(matchesProfile({ ...s, holeOffset: 0.2 }, p)).toBe(false);
    expect(applyProfile({ printer: "custom", custom: { x: 1, y: 1, z: 1 } }, profileFromSettings("p2", "A1", { printer: "bambu-a1" })).custom).toBeUndefined();
  });

  it("reads back only what is a profile", () => {
    expect(readProfile({ id: "p", name: "n", printer: "bambu-a1", fits: { press: "x" } })).toEqual({
      id: "p",
      name: "n",
      printer: "bambu-a1",
      holeOffset: 0.4,
      fits: { press: 0.15, sliding: 0.25, loose: 0.4 },
    });
    expect(readProfile({ id: "p", name: "n", printer: "nope" })).toBeNull();
    expect(readProfile("junk")).toBeNull();
  });

  it("finds fitted cuts made at another gap and updates them in one go", () => {
    let d = addPart(addPart(newDoc(), "box", "a"), "box", "b");
    d = addCombine(d, { mode: "combine", target: "a", tools: [cutTool("b", "sliding", 0)] }, "c1");
    expect(staleFits(d, {})).toEqual([]);
    const tuned = { fits: { sliding: 0.2 } };
    expect(staleFits(d, tuned).map((f) => f.id)).toEqual(["c1"]);
    const u = updateFits(d, tuned);
    expect(staleFits(u, tuned)).toEqual([]);
    expect(u.features.at(-1)).toMatchObject({ tools: [{ id: "b", op: "cut", fit: "sliding", gap: 0.2 }] });
  });
});
