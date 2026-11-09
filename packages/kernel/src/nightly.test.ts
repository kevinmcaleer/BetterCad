import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";
import { Exporter } from "./occt/exporter";
import { DEFLECTION, readStep } from "./occt/export";
import { measure } from "./occt/shapes";
import { BcadError, loadBcad } from "./bcad";
import { meshVolume, readStl } from "./export/mesh";

/**
 * The nightly run (#106): every model the project keeps (the samples, `fixtures/`, the format's test files) opened,
 * rebuilt at fine quality, measured, and exported to STL and STEP and read back. A fixture with a `.expected.json`
 * beside it must still measure the same. Off in the normal suite; `NIGHTLY=1` turns it on, and with UPDATE_GOLDEN=1
 * it writes the missing expectations.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const UPDATE = !!process.env.UPDATE_GOLDEN;

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".bcad") ? [p] : [];
  });
}

const MODELS = [
  ...files(join(ROOT, "web", "public", "samples")),
  ...files(join(ROOT, "fixtures")),
  ...files(join(ROOT, "packages", "kernel", "src", "testdata", "bcad")),
].map((p) => relative(ROOT, p));

let oc: OC;
let builder: ModelBuilder;
let exporter: Exporter;
beforeAll(async () => {
  oc = await loadOCCT();
  builder = new ModelBuilder(oc);
  exporter = new Exporter(oc, builder);
}, 60_000);

const round = (n: number) => Math.round(n * 1e4) / 1e4;

describe.skipIf(!process.env.NIGHTLY)("nightly: every model the project keeps", () => {
  it("finds the models", () => {
    expect(MODELS.length).toBeGreaterThanOrEqual(4);
  });

  // A fine build plus STL and STEP round trips of the 40-cut coupons takes 2 to 3 s on a laptop and 4 to 7 s on a CI
  // runner, past Vitest's 5 s default; a minute leaves room without hiding a real hang.
  it.each(MODELS.map((m) => [m]))(
    "%s opens, builds, measures and exports",
    (file) => {
      const loaded = loadBcad(readFileSync(join(ROOT, file), "utf8"));
      if (loaded instanceof BcadError) throw new Error(`${file}: ${loaded.message}`);
      const doc = loaded.doc;
      const r = builder.build(doc, doc.features.length, "fine");
      expect(r.failed, file).toEqual([]);
      const got = r.bodies.map((b) => ({ id: b.id, volume: round(b.measure.volume), area: round(b.measure.area), faces: b.measure.faces }));
      const total = r.bodies.reduce((a, b) => a + b.measure.volume, 0);

      // A fixture keeps what it measured when it was added.
      if (file.startsWith("fixtures")) {
        const want = file.replace(/\.bcad$/, ".expected.json");
        if (UPDATE || !existsSync(join(ROOT, want))) {
          if (!UPDATE && process.env.CI) throw new Error(`No ${want}. Run NIGHTLY=1 UPDATE_GOLDEN=1 npm run test:nightly and commit it.`);
          writeFileSync(join(ROOT, want), JSON.stringify(got, null, 2) + "\n");
        } else {
          const exp = JSON.parse(readFileSync(join(ROOT, want), "utf8")) as typeof got;
          expect(got.map((b) => b.id)).toEqual(exp.map((b) => b.id));
          got.forEach((b, i) => {
            expect(b.volume, `${file} ${b.id} volume`).toBeCloseTo(exp[i]!.volume, 2);
            expect(b.area, `${file} ${b.id} area`).toBeCloseTo(exp[i]!.area, 2);
            expect(b.faces, `${file} ${b.id} faces`).toBe(exp[i]!.faces);
          });
        }
      }
      if (!r.bodies.length) return;

      // STL at the fine setting holds the volume to within 1 %.
      const stl = exporter.export({ doc, bodies: null, format: "stl", deflection: DEFLECTION.fine, name: "nightly" });
      const meshed = stl.files.reduce((a, f) => a + meshVolume(readStl(f.data)), 0);
      expect(Math.abs(meshed - total) / total, `${file} STL volume`).toBeLessThan(0.01);

      // STEP is exact: the same volume and faces back.
      const step = exporter.export({ doc, bodies: null, format: "step", deflection: 0, name: "nightly" });
      const back = readStep(oc, step.files[0]!.data).map((b) => measure(oc, b.shape));
      expect(back.length, `${file} STEP solids`).toBe(r.bodies.filter((b) => b.measure.volume > 0).length);
      const backVolume = back.reduce((a, m) => a + m.volume, 0);
      expect(Math.abs(backVolume - total) / total, `${file} STEP volume`).toBeLessThan(1e-6);
      expect(back.reduce((a, m) => a + m.faces, 0)).toBe(r.bodies.reduce((a, b) => a + b.measure.faces, 0));
    },
    60_000,
  );
});
