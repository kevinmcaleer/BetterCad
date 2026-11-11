import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./oc";
import { ModelBuilder } from "./model";
import { Exporter } from "./exporter";
import { meshSolid } from "./imports";
import { elements } from "./shapes";
import { addCombine, addFinish, addImport, addPart, build, newDoc, placePart, type ImportFeature, type ModelDoc } from "../document";
import { write3mf, writeStl } from "../export/mesh";
import { blobHash, importFormat, toBase64, type ImportFormat } from "../imports";

let oc: OC;
let m: ModelBuilder;
beforeAll(async () => {
  oc = await loadOCCT();
  m = new ModelBuilder(oc);
}, 60_000);

/** A 10 mm cube, as 12 outward triangles, from (0,0,0). */
function cube(dz = 0): Float32Array {
  const p = (x: number, y: number, z: number) => [x * 10, y * 10, z * 10 + dz];
  const quads = [
    [p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)],
    [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)],
    [p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)],
    [p(1, 1, 0), p(0, 1, 0), p(0, 1, 1), p(1, 1, 1)],
    [p(0, 1, 0), p(0, 0, 0), p(0, 0, 1), p(0, 1, 1)],
    [p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)],
  ];
  return Float32Array.from(quads.flatMap(([a, b, c, d]) => [...a!, ...b!, ...c!, ...a!, ...c!, ...d!]));
}

function imported(file: string, bytes: ArrayBuffer, bodies: string[], doc = newDoc("Imports"), position = { x: 0, y: 0, z: 0 }): ModelDoc {
  const u = new Uint8Array(bytes);
  return addImport(
    doc,
    {
      file,
      format: importFormat(file) as ImportFormat,
      blob: blobHash(u),
      data: toBase64(u),
      bodies: bodies.map((id, i) => ({ id, name: `${file} ${i + 1}` })),
      position,
    },
    "imp",
  );
}

describe("imports (#82)", () => {
  it("brings in an STL as a closed mesh body of the right volume, standing on its origin", () => {
    const d = imported("cube.stl", writeStl("cube", [{ name: "cube", triangles: cube(5) }]), ["c"], undefined, { x: 30, y: 0, z: 0 });
    expect(build(d).parts[0]).toMatchObject({ id: "c", kind: "solid", imported: { mesh: true, format: "stl", index: 0 } });
    const r = m.build(d);
    expect(r.failed).toEqual([]);
    const b = r.bodies[0]!.measure;
    expect(b.volume).toBeCloseTo(1000, 3);
    expect(b.solids).toBe(1);
    // Coplanar triangles are merged: a cube reads as six faces.
    expect(b.faces).toBe(6);
    // Bottom centre at the import's position.
    expect(b.bbox.min[2]).toBeCloseTo(0, 6);
    expect((b.bbox.min[0] + b.bbox.max[0]) / 2).toBeCloseTo(30, 6);
  });

  it("refuses to fillet a mesh, and says to use STEP", () => {
    let d = imported("cube.stl", writeStl("cube", [{ name: "cube", triangles: cube() }]), ["c"]);
    d = addFinish(d, { type: "fillet", part: "c", refs: [0], size: 1 }, "fil");
    expect(m.build(d).failed).toContainEqual(["fil", "Imported meshes can't be filleted; use a STEP file for that"]);
  });

  it("combines a mesh body with a solid, as a tool and as the target", () => {
    let d = addPart(newDoc("Both"), "box", "box");
    d = imported("cube.stl", writeStl("cube", [{ name: "cube", triangles: cube() }]), ["c"], d, { x: 15, y: 0, z: 0 });
    // The 20 mm box spans -10…10; the cube 10…20 in X: they touch, so joined they hold both volumes.
    const join = addCombine(d, { mode: "combine", target: "box", tools: [{ id: "c", op: "join" }] }, "j");
    const r = m.build(join);
    expect(r.failed).toEqual([]);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(8000 + 1000, 3);
    const cut = addCombine(d, { mode: "combine", target: "c", tools: [{ id: "box", op: "cut" }] }, "k");
    expect(m.build(cut).bodies[0]!.measure.volume).toBeCloseTo(1000, 3);
  });

  it("brings in each object of a 3MF", () => {
    const data = write3mf("Two", [
      { name: "Low", triangles: cube() },
      { name: "High", triangles: cube(20) },
    ]);
    const d = imported("two.3mf", data, ["a", "b"]);
    const r = m.build(d);
    expect(r.bodies.map((b) => Math.round(b.measure.volume))).toEqual([1000, 1000]);
  });

  it("round-trips the exported STEP of a model as exact solids", () => {
    const src = addPart(addPart(newDoc("Kit"), "cylinder", "cy"), "box", "bx");
    const want = m.build(src).bodies.map((b) => b.measure.volume);
    const step = new Exporter(oc, m).export({ doc: src, bodies: null, format: "step", deflection: 0, name: "Kit" }).files[0]!.data;
    const d = imported("kit.step", step, ["s1", "s2"]);
    const r = m.build(d);
    expect(r.failed).toEqual([]);
    const got = r.bodies.map((b) => b.measure.volume).sort((a, b) => a - b);
    expect(got[0]).toBeCloseTo(Math.min(...want), 6);
    expect(got[1]).toBeCloseTo(Math.max(...want), 6);
    // STEP bodies are exact: they can be filleted.
    const f = addFinish(d, { type: "fillet", part: "s2", refs: [0], size: 0.5 }, "fil");
    expect(m.build(f).failed.find(([id]) => id === "fil")).toBeUndefined();
  });

  it("keeps a STEP assembly's layout: each body where the source app placed it", () => {
    // Two 20 mm boxes, one 40 mm along X and 15 mm up, as an assembly would have them.
    let src = addPart(addPart(newDoc("Pair"), "box", "a"), "box", "b");
    src = placePart(src, "b", { x: 40, y: 0, z: 15 }, { x: 0, y: 0, z: 0 });
    const step = new Exporter(oc, m).export({ doc: src, bodies: null, format: "step", deflection: 0, name: "Pair" }).files[0]!.data;
    const d = imported("pair.step", step, ["s1", "s2"], undefined, { x: 100, y: 0, z: 0 });
    const r = m.build(d);
    expect(r.failed).toEqual([]);
    const boxes = r.bodies.map((b) => b.measure.bbox).sort((p, q) => p.min[0] - q.min[0]);
    // The pair spans -10…50 in X and 0…35 in Z; its bottom centre lands on the import's position.
    expect(boxes[0]!.min[0]).toBeCloseTo(70, 4);
    expect(boxes[1]!.min[0] - boxes[0]!.min[0]).toBeCloseTo(40, 4);
    expect(boxes[0]!.min[2]).toBeCloseTo(0, 4);
    expect(boxes[1]!.min[2]).toBeCloseTo(15, 4);
  });

  it("still stands each body on its own for an import made before layouts were kept", () => {
    const data = write3mf("Two", [
      { name: "Low", triangles: cube() },
      { name: "High", triangles: cube(20) },
    ]);
    const now = imported("two.3mf", data, ["a", "b"]);
    expect((now.features[0] as ImportFeature).keepLayout).toBe(true);
    expect(m.build(now).bodies.map((b) => Math.round(b.measure.bbox.min[2]))).toEqual([0, 20]);
    const old = { ...now, features: now.features.map((f) => ({ ...f, keepLayout: undefined })) } as ModelDoc;
    expect(m.build(old).bodies.map((b) => Math.round(b.measure.bbox.min[2]))).toEqual([0, 0]);
  });

  it("keeps a file's bytes once however many times it is imported", () => {
    const bytes = writeStl("cube", [{ name: "cube", triangles: cube() }]);
    let d = imported("cube.stl", bytes, ["a"]);
    d = imported("cube.stl", bytes, ["b"], d);
    expect(Object.keys(d.blobs!)).toHaveLength(1);
    expect(d.features.map((f) => f.name)).toEqual(["Import 1", "Import 2"]);
  });

  it("says how far it has got while it reads a mesh and a STEP file", () => {
    const read = (file: string, bytes: ArrayBuffer) => {
      const u = new Uint8Array(bytes);
      const seen: number[] = [];
      new ModelBuilder(oc).inspect({ name: file, format: importFormat(file)!, blob: blobHash(u), data: toBase64(u) }, (f) => seen.push(f));
      return seen;
    };
    // Enough triangles for the loop to tick more than once.
    const many = cubes(500);
    const mesh = read("many.stl", writeStl("many", [{ name: "many", triangles: many }]));
    expect(mesh.length).toBeGreaterThan(3);
    expect(mesh).toEqual([...mesh].sort((a, b) => a - b));
    expect(mesh.at(-1)).toBeGreaterThanOrEqual(0.9);
    const step = read(
      "kit.step",
      new Exporter(oc, m).export({ doc: addPart(newDoc("Kit"), "box", "bx"), bodies: null, format: "step", deflection: 0, name: "Kit" }).files[0]!.data,
    );
    expect(step).toEqual([...step].sort((a, b) => a - b));
    expect(step.at(-1)).toBeGreaterThanOrEqual(0.9);
  });

  it("counts a mesh's faces each once, however many there are", () => {
    // 500 cubes in a row, none touching: more than one shell, so each of the 6,000 triangles stays its own face.
    const { shape } = meshSolid(oc, cubes(500));
    const t = performance.now();
    expect(elements(oc, shape, "face")).toHaveLength(6000);
    // Listing them used to check each face against all the others, about 6 s here; now it takes a few ms.
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

/** `n` 10 mm cubes in a row, 5 mm apart, as one mesh. */
function cubes(n: number): Float32Array {
  const one = cube();
  const out = new Float32Array(one.length * n);
  for (let k = 0; k < n; k++) for (let i = 0; i < one.length; i++) out[k * one.length + i] = one[i]! + (i % 3 === 0 ? k * 15 : 0);
  return out;
}
