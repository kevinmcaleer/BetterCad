import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { drawRectangle, type Sketch } from "@bettercad/sketch";
import { BcadError, BCAD_SCHEMA, fileName, loadBcad, nameFromFile, NEWER_WARNING, saveBcad, validate } from "./bcad";
import schema from "./bcad.schema.json";
import { addExtrude, addParam, addSketch, build, newDoc, updateSketch, type ModelDoc } from "./document";

const sample = (f: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "testdata", "bcad", f), "utf8");

/** The model every sample file holds: one 40 × 20 × 20 box called Bracket. */
function bracket(): ModelDoc {
  return {
    ...newDoc("Bracket"),
    features: [
      {
        id: "f1",
        type: "add",
        name: "Box 1",
        part: { id: "p1", name: "Box 1", kind: "box", position: { x: 0, y: 0, z: 10 }, size: { x: 40, y: 20, z: 20 } },
      },
    ],
  };
}

/** The timeline test model (#78): twenty steps, a sketch and an extrude ten times over. */
function tower(): ModelDoc {
  const square = (d: ModelDoc, id: string, up: number) => {
    const s = addSketch(d, { kind: "world", plane: "XY", offset: up }, id);
    return updateSketch(s, id, (k: Sketch) => drawRectangle(k, [0, 0], [10, 10]).sketch);
  };
  let d = square(newDoc("Tower"), "s0", 0);
  d = addExtrude(d, { sketch: "s0", seeds: [[5, 5]], distance: 10, direction: "one", operation: "new" }, "x0", "body");
  for (let k = 1; k < 10; k++) {
    d = square(d, `s${k}`, 10 * k);
    d = addExtrude(d, { sketch: `s${k}`, seeds: [[5, 5]], distance: 10, direction: "one", operation: "join", target: "body" }, `x${k}`);
  }
  return d;
}

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe(".bcad files (#79)", () => {
  it("round-trips the 20-step timeline model with its header and thumbnail", () => {
    const d = addParam(tower());
    const text = saveBcad(d, { thumbnail: PNG, id: "m1", created: "2026-01-01T00:00:00.000Z", now: new Date("2026-02-01T00:00:00Z") });
    const r = loadBcad(text);
    if (r instanceof BcadError) throw r;
    expect(r.doc).toEqual(JSON.parse(JSON.stringify(d)));
    expect(r.meta).toMatchObject({ schema: BCAD_SCHEMA, app: "bettercad", id: "m1", name: "Tower", thumbnail: PNG, created: "2026-01-01T00:00:00.000Z" });
    expect(r.meta.modified).toBe("2026-02-01T00:00:00.000Z");
    expect(r.warning).toBeUndefined();
    expect(build(r.doc).parts).toHaveLength(1);
    // Small and readable.
    expect(text.length).toBeLessThan(50_000);
    expect(text.split("\n")[1]).toBe('  "schema": 1,');
  });

  it("writes the same bytes for the same model, whatever order its keys were made in", () => {
    const a = bracket();
    const flip = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(flip)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v)
                .reverse()
                .map(([k, x]) => [k, flip(x)]),
            )
          : v;
    const b = flip(a) as ModelDoc;
    expect(Object.keys(b)[0]).toBe(Object.keys(a).at(-1));
    const now = new Date("2026-01-01T00:00:00Z");
    expect(saveBcad(b, { now })).toBe(saveBcad(a, { now }));
  });

  it("loads a file of every past schema to the same document as a freshly built one", () => {
    for (const f of ["schema0-parts.json", "schema0-timeline.bettercad.json", "schema1.bcad"]) {
      const r = loadBcad(sample(f));
      if (r instanceof BcadError) throw new Error(`${f}: ${r.message}`);
      expect(r.doc, f).toEqual(bracket());
      expect(r.meta.schema).toBe(BCAD_SCHEMA);
      expect(r.meta.name).toBe("Bracket");
    }
  });

  it("gives a one-line error for a corrupted file", () => {
    for (const text of ["", "nope", "[]", "{}", '{"schema":1,"app":"bettercad"}', sample("schema1.bcad").slice(0, 200)]) {
      const r = loadBcad(text);
      expect(r).toBeInstanceOf(BcadError);
      expect((r as BcadError).message).not.toContain("\n");
    }
    const bad = JSON.parse(sample("schema1.bcad"));
    bad.document.features[0].id = 7;
    expect((loadBcad(JSON.stringify(bad)) as BcadError).message).toBe("That file is damaged: document.features[0].id should be a string.");
  });

  it("keeps steps and fields from a newer BetterCad, and warns", () => {
    const f = JSON.parse(sample("schema1.bcad"));
    f.schema = 2;
    f.document.features.push({ id: "f2", type: "loft", name: "Loft 1", sections: ["a", "b"] });
    f.document.layers = [{ id: "l1" }];
    const r = loadBcad(JSON.stringify(f));
    if (r instanceof BcadError) throw r;
    expect(r.warning).toBe(NEWER_WARNING);
    expect(r.doc.features[1]).toEqual({ id: "f2", type: "loft", name: "Loft 1", sections: ["a", "b"] });
    expect((r.doc as unknown as { layers: unknown }).layers).toEqual([{ id: "l1" }]);
    // It stays in the file on the next save, and the step says why it does not build.
    expect(saveBcad(r.doc)).toContain('"type": "loft"');
    expect(build(r.doc).failed.get("f2")).toBe("This step needs a newer BetterCad");
  });

  it("validates against the published schema", () => {
    expect(validate(schema as never, JSON.parse(saveBcad(bracket(), { thumbnail: PNG })), "")).toBeNull();
    expect(validate(schema as never, { ...JSON.parse(saveBcad(bracket())), thumbnail: "x" }, "")).toBe("thumbnail is not in the right form");
  });

  it("names files from the model and models from files", () => {
    expect(fileName("Bracket v2")).toBe("Bracket v2.bcad");
    expect(fileName('a/b:c*"')).toBe("abc.bcad");
    expect(fileName("  ")).toBe("model.bcad");
    expect(nameFromFile("Bracket.bcad")).toBe("Bracket");
    expect(nameFromFile("old.bettercad.json")).toBe("old");
  });
});
