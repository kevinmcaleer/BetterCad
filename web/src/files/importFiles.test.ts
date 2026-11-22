import { describe, expect, it, vi } from "vitest";
import { writeStl } from "@bettercad/kernel/mesh-files";
import { newDoc, type ModelDoc } from "../state/document";
import { quickMeshes } from "../viewport/quickMeshes";
import { importFiles, quickMesh, type ImportContext, type ImportProgress } from "./importFiles";

/** A 10 mm cube from (0,0,0), as 12 triangles. */
function cube(): Float32Array {
  const p = (x: number, y: number, z: number) => [x * 10, y * 10, z * 10];
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

const fileOf = (name: string, bytes: ArrayBuffer) => ({ name, arrayBuffer: async () => bytes }) as unknown as File;

/** A kernel whose inspect waits until `finish` is called, posting progress on the way. */
function setup() {
  let doc: ModelDoc = newDoc("Imports");
  const seen: (ImportProgress | null)[] = [];
  let finish!: (info: { bodies: { name: string; open: boolean; triangles?: number }[] }) => void;
  let onProgress: ((f: number) => void) | undefined;
  let release!: () => void;
  const ctx: ImportContext = {
    call: ((_m: string, _p: unknown, progress?: (f: number) => void) => {
      onProgress = progress;
      const p = new Promise((resolve) => (finish = resolve)) as unknown as ReturnType<ImportContext["call"]>;
      return Object.assign(p!, { cancel: () => undefined });
    }) as ImportContext["call"],
    record: (fn) => (doc = fn(doc, undefined)),
    say: vi.fn(),
    select: vi.fn(),
    progress: (p) => seen.push(p),
    ready: () => new Promise<void>((r) => (release = r)),
  };
  return {
    ctx,
    seen,
    doc: () => doc,
    finish: (i: Parameters<typeof finish>[0]) => finish(i),
    progress: (f: number) => onProgress?.(f),
    release: () => release(),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("importing with progress", () => {
  it("puts an STL on the timeline and on show before the kernel has read it, then waits for the kernel's mesh", async () => {
    const k = setup();
    const done = importFiles([fileOf("cube.stl", writeStl("cube", [{ name: "cube", triangles: cube() }]))], undefined, k.ctx);
    await tick();
    // On the timeline already, drawn from the file's own triangles.
    const part = k.doc().features.find((f) => f.type === "import");
    expect(part).toBeTruthy();
    expect(quickMeshes.size).toBe(1);
    k.progress(0.5);
    expect(k.seen.at(-1)).toMatchObject({ file: "cube.stl", n: 1, of: 1, stage: "Joining the triangles", fraction: expect.closeTo(0.5, 6) });
    k.finish({ bodies: [{ name: "cube", open: false, triangles: 12 }] });
    await tick();
    // The kernel has read it; the toast stays until its mesh is on show.
    expect(k.seen.at(-1)).toMatchObject({ stage: "Getting it ready to edit", fraction: undefined });
    expect(k.ctx.say).not.toHaveBeenCalled();
    k.release();
    await done;
    expect(k.seen.at(-1)).toBeNull();
    expect(quickMeshes.size).toBe(0);
    expect(k.ctx.say).toHaveBeenCalledWith("Imported 1 body from cube.stl. To change its holes, right-click it and choose Recognise features");
    // The bar only goes forward.
    const bar = k.seen.flatMap((p) => (p?.fraction === undefined ? [] : [p.fraction]));
    expect(bar).toEqual([...bar].sort((a, b) => a - b));
  });

  it("adds a STEP file once the kernel has read it", async () => {
    const k = setup();
    const done = importFiles([fileOf("kit.step", new TextEncoder().encode("ISO-10303-21;").buffer as ArrayBuffer)], undefined, k.ctx);
    await tick();
    expect(k.doc().features).toHaveLength(0);
    expect(k.seen.at(-1)).toMatchObject({ stage: "Reading the solids" });
    k.finish({ bodies: [{ name: "kit", open: false }] });
    await tick();
    expect(k.doc().features).toHaveLength(1);
    expect(k.seen.at(-1)).toMatchObject({ stage: "Drawing it" });
    k.release();
    await done;
    expect(k.seen.at(-1)).toBeNull();
  });

  it("clears the toast when a file can't be read", async () => {
    const k = setup();
    k.ctx.call = (() => Object.assign(Promise.reject(new Error("That STEP file could not be read.")), { cancel: () => undefined })) as ImportContext["call"];
    await importFiles([fileOf("bad.step", new ArrayBuffer(4))], undefined, k.ctx);
    expect(k.ctx.say).toHaveBeenCalledWith("bad.step: That STEP file could not be read.", true);
    expect(k.seen.at(-1)).toBeNull();
  });
});

describe("quickMesh", () => {
  it("stands the triangles with their bottom centre on the origin, as the kernel does", () => {
    const m = quickMesh(cube());
    let lo = Infinity;
    let x = [Infinity, -Infinity];
    for (let i = 0; i < m.positions.length; i += 3) {
      lo = Math.min(lo, m.positions[i + 2]!);
      x = [Math.min(x[0]!, m.positions[i]!), Math.max(x[1]!, m.positions[i]!)];
    }
    expect(lo).toBe(0);
    expect(x).toEqual([-5, 5]);
    expect(m.indices).toHaveLength(36);
    expect(m.faceTris).toEqual(Uint32Array.of(0, 12));
    // Flat normals of unit length.
    expect(Math.hypot(m.normals[0]!, m.normals[1]!, m.normals[2]!)).toBeCloseTo(1, 6);
  });

  it("keeps a body where it sits in a file of several, as the kernel keeps the file's layout", () => {
    // A second cube 30 mm along X and 20 mm up: the file spans 0…40 in X and 0…30 in Z.
    const high = cube().map((v, i) => v + (i % 3 === 0 ? 30 : i % 3 === 2 ? 20 : 0));
    const m = quickMesh(high, [cube(), high]);
    const xs = m.positions.filter((_, i) => i % 3 === 0);
    const zs = m.positions.filter((_, i) => i % 3 === 2);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([10, 20]);
    expect(Math.min(...zs)).toBe(20);
  });
});

describe("inserting a file as a component", () => {
  it("puts an STL's bodies in a new component named after the file, inside the active one", async () => {
    const k = setup();
    k.ctx.component = { parent: "f-arm" };
    const done = importFiles([fileOf("servo horn.stl", writeStl("horn", [{ name: "horn", triangles: cube() }]))], undefined, k.ctx);
    await tick();
    const [imp, link] = k.doc().features;
    expect(imp).toMatchObject({ type: "import", file: "servo horn.stl" });
    expect(link).toMatchObject({ type: "link", name: "servo horn", parent: "f-arm" });
    expect(link?.type === "link" && link.parts).toEqual(imp?.type === "import" ? imp.bodies.map((b) => b.id) : []);
    k.finish({ bodies: [{ name: "horn", open: false, triangles: 12 }] });
    await tick();
    k.release();
    await done;
    expect(k.ctx.say).toHaveBeenCalledWith("Inserted servo horn.stl as a component. Use Move or Joint to put it in place.", false, true);
  });

  it("adds the component after the import when the marker is back on the timeline", async () => {
    const k = setup();
    k.ctx.component = {};
    let docs = 0;
    const record = k.ctx.record;
    k.ctx.record = (fn, label) => {
      docs++;
      expect(label).toBe("Insert cube.stl");
      record((d) => fn(d, 0), label);
    };
    const done = importFiles([fileOf("cube.stl", writeStl("cube", [{ name: "cube", triangles: cube() }]))], undefined, k.ctx);
    await tick();
    expect(docs).toBe(1);
    expect(k.doc().features.map((f) => f.type)).toEqual(["import", "link"]);
    k.finish({ bodies: [{ name: "cube", open: false, triangles: 12 }] });
    await tick();
    k.release();
    await done;
  });
});
