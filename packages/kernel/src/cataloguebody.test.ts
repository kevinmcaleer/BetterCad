import { beforeAll, describe, expect, it } from "vitest";
import { cataloguePart } from "./catalogue/list";
import { insertCatalogue, newDoc } from "./document";
import { blobHash, toBase64 } from "./imports";
import { Exporter } from "./occt/exporter";
import { ModelBuilder } from "./occt/model";
import { loadOCCT, type OC } from "./occt/oc";

/**
 * A robot catalogue part as an electronics part's body (#628). In a model it is a reference body, which is never
 * exported; with Reference turned off it goes out as STEP, which is how the part editor keeps a copy of it.
 */
describe("a catalogue part as a STEP file", () => {
  let oc: OC;
  beforeAll(async () => {
    oc = await loadOCCT();
  }, 60_000);

  it("is not exported as a reference body, and is as an ordinary one", () => {
    const builder = new ModelBuilder(oc);
    const exporter = new Exporter(oc, builder);
    const servo = cataloguePart("sg90")!;
    const placed = insertCatalogue(newDoc(servo.name), servo, { position: { x: 0, y: 0, z: 0 } }, "pcat", "fcat");
    const ask = { bodies: null, format: "step" as const, deflection: 0, name: servo.name };
    expect(() => exporter.export({ ...ask, doc: placed })).toThrow("Reference bodies aren't exported");

    const out = exporter.export({ ...ask, doc: { ...placed, looks: { pcat: { reference: false } } } }).files[0]!;
    const bytes = new Uint8Array(out.data);
    const info = builder.inspect({ name: out.name, format: "step", blob: blobHash(bytes), data: toBase64(bytes) });
    expect(info.bodies.length).toBeGreaterThan(0);
    // An SG90 is about 23 by 12 mm, and 32 mm across its mounting tabs.
    const size = [...info.size!].sort((a, b) => a - b);
    expect(size[0]).toBeGreaterThan(10);
    expect(size[2]).toBeGreaterThan(22);
    expect(size[2]).toBeLessThan(45);
  });
});
