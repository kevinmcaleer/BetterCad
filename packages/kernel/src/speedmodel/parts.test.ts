import { beforeAll, describe, expect, it } from "vitest";
import { build } from "../document";
import { loadOCCT, type OC } from "../occt/oc";
import { ModelBuilder } from "../occt/model";
import { PARTS } from "./parts";

/**
 * Speed-modelling parts as a torture test: each is built from its timeline and weighed against the challenge's answer.
 * Within 1 g, as build123d's reference checks.
 */
let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

const buildable = PARTS.filter((p) => p.build);

describe("speed-modelling parts", () => {
  it.each(buildable.map((p) => [p.name, p] as const))("%s builds to the challenge's mass", (_, part) => {
    const doc = part.build!(oc);
    expect([...build(doc).failed]).toEqual([]);
    const r = new ModelBuilder(oc).build(doc, undefined, "fine");
    expect(r.failed).toEqual([]);
    const bodies = r.bodies.filter((b) => !doc.looks[b.id]?.hidden);
    expect(bodies).toHaveLength(1);
    const mass = bodies[0]!.measure.volume * part.density;
    if (process.env.SPEED_LOG) console.log(part.name, mass.toFixed(2), part.mass);
    expect(Math.abs(mass - part.mass), `${mass.toFixed(2)} g, want ${part.mass} g`).toBeLessThan(1);
  });

  // The parts BetterCad can't model yet show as to-dos, each with what it is missing.
  for (const p of PARTS.filter((x) => !x.build)) it.todo(`${p.name}: ${p.missing!.join("; ")}`);

  it("lists all ten parts, each buildable or saying what it needs", () => {
    expect(PARTS).toHaveLength(10);
    for (const p of PARTS) expect(!!p.build !== !!p.missing?.length).toBe(true);
  });
});
