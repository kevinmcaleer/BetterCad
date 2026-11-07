/**
 * Kernel benchmarks (#50, #108): the operations a person waits on, timed in Node with the same WASM the worker loads.
 * Each runs a few times and reports the median, in ms. `npm run bench:kernel` prints a table; `-- --ci` runs fewer
 * times; `-- --json out.json` writes the medians for the budget check (scripts/budgets.mjs).
 */
import { writeFileSync } from "node:fs";
import { loadOCCT } from "../src/occt/oc";
import { ModelBuilder } from "../src/occt/model";
import { box, fillet, shell, sphere } from "../src/occt/shapes";
import { tessellate } from "../src/occt/tessellate";
import { SAMPLES } from "../src/samples";
import { thickness } from "../src/print/checks";
import { suggestOrientations } from "../src/print/orient";

const args = process.argv.slice(2);
const ci = args.includes("--ci");
const out = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;
const runs = ci ? 3 : 7;

const oc = await loadOCCT();
const sample = (id: string) => SAMPLES.find((s) => s.id === id)!.build();
const ball = tessellate(oc, shell(oc, sphere(oc, { x: 60, y: 60, z: 60 }), [], 1), "fine");

const cases: Record<string, () => unknown> = {
  "Build the phone stand sample": () => new ModelBuilder(oc).build(sample("phone-stand")),
  "Build the hole calibration coupon (40 cuts)": () => new ModelBuilder(oc).build(sample("hole-calibration")),
  "Fillet all 12 edges of a box": () => fillet(oc, box(oc, { x: 20, y: 20, z: 20 }), [...Array(12).keys()], 2),
  "Mesh a hollow sphere, fine": () => tessellate(oc, shell(oc, sphere(oc, { x: 60, y: 60, z: 60 }), [], 1), "fine"),
  "Thin-wall check, hollow sphere": () => thickness(ball, 0.8),
  "Orientation suggestions, hollow sphere": () => suggestOrientations([ball]),
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const result: Record<string, number> = {};
for (const [name, run] of Object.entries(cases)) {
  run(); // Warm up: the first call pays for JIT and OCCT's lazy setup.
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    run();
    times.push(performance.now() - t);
  }
  result[name] = Math.round(median(times) * 10) / 10;
  console.log(`${name.padEnd(48)} ${result[name]!.toFixed(1).padStart(8)} ms`);
}
console.log(`${ball.indices.length / 3} triangles in the hollow sphere; median of ${runs} runs.`);
if (out) writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
