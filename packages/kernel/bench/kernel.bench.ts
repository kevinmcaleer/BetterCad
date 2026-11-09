/**
 * Kernel benchmarks (#50, #108): the operations a person waits on, timed in Node with the same WASM the worker loads.
 * Each runs several times and reports the median and 95th percentile, in ms. `npm run bench:kernel` prints a table;
 * `-- --ci` runs fewer times; `-- --json out.json` writes the medians (what scripts/budgets.mjs checks), the 95th
 * percentiles, the WASM heap and the machine. Bodies are made here, not read from fixtures.
 */
import { writeFileSync } from "node:fs";
import { arch, cpus, platform, totalmem } from "node:os";
import { loadOCCT, loadTimes } from "../src/occt/oc";
import { ModelBuilder } from "../src/occt/model";
import { boolean, box, count, cylinder, fillet, measure, place, prismOf, shell, sphere } from "../src/occt/shapes";
import type { TopoDS_Shape } from "replicad-opencascadejs";
import { addPart, changeParts, newDoc } from "../src/document";
import { tessellate } from "../src/occt/tessellate";
import { SAMPLES } from "../src/samples";
import { thickness } from "../src/print/checks";
import { suggestOrientations } from "../src/print/orient";

const args = process.argv.slice(2);
const ci = args.includes("--ci");
const out = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;
const runs = ci ? 3 : 10;

const t0 = performance.now();
const oc = await loadOCCT();
const loadMs = performance.now() - t0;
const sample = (id: string) => SAMPLES.find((s) => s.id === id)!.build();
const ball = tessellate(oc, shell(oc, sphere(oc, { x: 60, y: 60, z: 60 }), [], 1), "fine");

/** A 10 mm thick plate with an n × n grid of 2 mm holes, cut in one go: a body with many faces. */
function plate(n: number, dx = 0): TopoDS_Shape {
  const size = n * 4 + 4;
  const base = place(oc, box(oc, { x: size, y: size, z: 10 }), { position: { x: dx, y: 0, z: 0 } });
  const holes: TopoDS_Shape[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      holes.push(place(oc, cylinder(oc, { x: 2, y: 2, z: 12 }), { position: { x: dx - size / 2 + 4 + 4 * i, y: -size / 2 + 4 + 4 * j, z: -1 } }));
  const tools = new oc.NCollection_List_TopoDS_Shape();
  for (const h of holes) tools.Append(h);
  const args = new oc.NCollection_List_TopoDS_Shape();
  args.Append(base);
  const mk = new oc.BRepAlgoAPI_Cut();
  mk.SetArguments(args);
  mk.SetTools(tools);
  mk.Build(new oc.Message_ProgressRange());
  return mk.Shape();
}
const A = plate(12);
const B = plate(12, 30);
/** A 20-sided outline, as an extrude gets from a sketch of 20 lines. */
const twenty = {
  frame: { origin: [0, 0, 0] as [number, number, number], x: [1, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] },
  profiles: [
    {
      outer: [...Array(20).keys()].map((i) => {
        const p = (k: number): [number, number] => [20 * Math.cos((k * Math.PI) / 10), 20 * Math.sin((k * Math.PI) / 10)];
        return { kind: "line" as const, a: p(i), b: p(i + 1) };
      }),
      holes: [],
      area: 0,
    },
  ],
  from: 0,
  to: 10,
};
/** A box with a square hole through it: 24 edges. */
const frame = boolean(oc, "cut", box(oc, { x: 30, y: 30, z: 10 }), [place(oc, box(oc, { x: 10, y: 10, z: 20 }), { position: { x: 0, y: 0, z: -5 } })]);

const cases: Record<string, () => unknown> = {
  "Build the phone stand sample": () => new ModelBuilder(oc).build(sample("phone-stand")),
  "Build the hole calibration coupon (40 cuts)": () => new ModelBuilder(oc).build(sample("hole-calibration")),
  "Fillet all 12 edges of a box": () => fillet(oc, box(oc, { x: 20, y: 20, z: 20 }), [...Array(12).keys()], 2),
  "Mesh a hollow sphere, fine": () => tessellate(oc, shell(oc, sphere(oc, { x: 60, y: 60, z: 60 }), [], 1), "fine"),
  "Thin-wall check, hollow sphere": () => thickness(ball, 0.8),
  "Orientation suggestions, hollow sphere": () => suggestOrientations([ball]),
  "Make a 10 mm box": () => box(oc, { x: 10, y: 10, z: 10 }),
  "Extrude a 20-line sketch": () => prismOf(oc, twenty),
  [`Join two plates of ${count(oc, A, "face")} faces each`]: () => boolean(oc, "join", A, [B]),
  "Fillet 24 edges": () => fillet(oc, frame, [...Array(24).keys()], 1),
  "Shell a box, top open": () => shell(oc, box(oc, { x: 20, y: 20, z: 20 }), [5], 1.2),
  "Mesh the plate, fast": () => tessellate(oc, A, "fast"),
  "Mesh the plate, fine": () => tessellate(oc, A, "fine"),
  "Measure the plate": () => measure(oc, A),
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const p95 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]!;
};
const r1 = (n: number) => Math.round(n * 10) / 10;
const result: Record<string, number> = {};
const tail: Record<string, number> = {};
console.log(`${"".padEnd(48)} ${"median".padStart(8)}    ${"p95".padStart(8)}`);
for (const [name, run] of Object.entries(cases)) {
  run(); // Warm up: the first call pays for JIT and OCCT's lazy setup.
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    run();
    times.push(performance.now() - t);
  }
  result[name] = r1(median(times));
  tail[name] = r1(p95(times));
  console.log(`${name.padEnd(48)} ${result[name]!.toFixed(1).padStart(8)} ms ${tail[name]!.toFixed(1).padStart(8)} ms`);
}

// Memory: the WASM heap after the set, and whether it grows over 100 edits and undos of a model.
const heap = () => (oc as unknown as { wasmMemory: WebAssembly.Memory }).wasmMemory.buffer.byteLength / 1024 / 1024;
const afterSet = heap();
const m = new ModelBuilder(oc);
const before = addPart(addPart(newDoc(), "box", "a"), "cylinder", "b");
for (let i = 0; i < 100; i++) {
  m.build(changeParts(before, ["b"], "position", { x: 5 + (i % 7) }));
  m.build(before);
}
const afterCycles = heap();
console.log(`WASM heap: ${afterSet.toFixed(0)} MB after the set, ${afterCycles.toFixed(0)} MB after 100 edit and undo cycles.`);
console.log(`Loaded the WASM in ${loadMs.toFixed(0)} ms (compile and start ${loadTimes.start?.toFixed(0)} ms).`);
console.log(`${ball.indices.length / 3} triangles in the hollow sphere; ${runs} runs each.`);
const machine = {
  platform: platform(),
  arch: arch(),
  cpu: cpus()[0]?.model ?? "unknown",
  cores: cpus().length,
  memoryGB: Math.round(totalmem() / 1024 ** 3),
  node: process.version,
};
if (out)
  writeFileSync(
    out,
    JSON.stringify(
      { ...result, $p95: tail, $heapMB: { afterSet: r1(afterSet), afterCycles: r1(afterCycles) }, $loadMs: r1(loadMs), $machine: machine },
      null,
      2,
    ) + "\n",
  );
