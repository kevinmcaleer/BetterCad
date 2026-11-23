import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { BcadError, loadBcad, saveBcad } from "@bettercad/kernel/bcad";
import { type Feature, type ModelDoc, newDoc } from "@bettercad/kernel/document";
import { type Drawing, type DrawingSheet, type DrawingView, newSheet } from "@bettercad/kernel/drawing";
import { loadOCCT, ModelBuilder, projectView } from "@bettercad/kernel/occt";
import { SAMPLES } from "@bettercad/kernel/samples";
import type { ModelView } from "@bettercad/kernel/view";
import { AUTO_START, autoDimension, candidates, RANKS, type AutoOptions } from "./auto";
import { contextOf } from "./arrange";
import { dimArt } from "./dimensions";
import { sceneDxf } from "./export/dxf";
import { pdfContent, scenePdf } from "./export/pdf";
import { sheetScene } from "./export/scene";
import { sceneSvg } from "./export/svg";
import { follow, problems, stamp } from "./follow";
import { sheetLayout } from "./layout";
import { viewRequest } from "./views";

/**
 * Fixture drawings (#570): real models with a drawing in them, drawn by the real kernel. They pin down what Auto
 * dimension offers for each (golden lists beside the files), that a saved drawing still finds every edge and face it
 * was fixed to, and, nightly, that each sheet writes to SVG, PDF and DXF with nothing dropped.
 *
 * `UPDATE_GOLDEN=1 npm run test:golden` writes the fixtures and their lists again after a deliberate change.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIR = join(ROOT, "fixtures", "drawings");
const UPDATE = !!process.env.UPDATE_GOLDEN;
const WHEN = new Date("2026-11-23T00:00:00Z");

/** A 60 mm square flange, 6 mm thick: a 16 mm bore and four 5 mm holes on a 40 mm bolt circle. */
function flange(): ModelDoc {
  const doc = newDoc("Flange");
  let n = 0;
  const push = (f: Record<string, unknown>) => doc.features.push({ ...f, id: `f${++n}` } as Feature);
  const part = (id: string, name: string, kind: "box" | "cylinder", size: [number, number, number], at: [number, number, number] = [0, 0, 0]) => {
    push({ type: "add", name: `Add ${name}`, part: { id, name, kind, position: { x: 0, y: 0, z: 0 }, size: { x: 10, y: 10, z: 10 } } });
    push({ type: "resize", name: `Size ${name}`, parts: [id], size: { x: size[0], y: size[1], z: size[2] } });
    if (at.some((v) => v !== 0)) push({ type: "move", name: `Place ${name}`, parts: [id], position: { x: at[0], y: at[1], z: at[2] } });
  };
  part("plate", "Flange", "box", [60, 60, 6]);
  const tools: { id: string; op: "cut" }[] = [];
  const cut = (id: string, name: string, d: number, x: number, y: number) => {
    part(id, name, "cylinder", [d, d, 8], [x, y, -1]);
    doc.looks[id] = { ...doc.looks[id], hole: true };
    tools.push({ id, op: "cut" });
  };
  cut("bore", "Bore", 16, 0, 0);
  [
    [20, 0],
    [0, 20],
    [-20, 0],
    [0, -20],
  ].forEach(([x, y], i) => cut(`bolt${i + 1}`, `Bolt hole ${i + 1}`, 5, x!, y!));
  push({ type: "combine", name: "Flange with holes", mode: "group", target: "plate", tools });
  return doc;
}

interface Fixture {
  file: string;
  model: () => ModelDoc;
  size: "A3" | "tabloid";
  /** Paper over real. */
  scale: number;
  views: { id: string; direction: "front" | "top" | "right"; at: [number, number] }[];
  auto: AutoOptions;
}
const FIXTURES: Fixture[] = [
  {
    // ISO, first angle: the view from above sits under the front view.
    file: "flange-bolt-circle",
    model: flange,
    size: "A3",
    scale: 1,
    views: [
      { id: "v1", direction: "top", at: [140, 180] },
      { id: "v2", direction: "front", at: [140, 95] },
    ],
    auto: { recipe: "centre-baseline", datum: "bottom-left", density: 1 },
  },
  {
    // ASME, third angle: the view from above sits over the front view, the right side to its right.
    file: "phone-stand",
    model: () => SAMPLES.find((s) => s.id === "phone-stand")!.build(),
    size: "tabloid",
    scale: 1,
    views: [
      { id: "v1", direction: "front", at: [130, 110] },
      { id: "v2", direction: "top", at: [130, 200] },
      { id: "v3", direction: "right", at: [260, 110] },
    ],
    auto: { recipe: "chain", datum: "bottom-left", density: 1 },
  },
];

let builder: ModelBuilder;
beforeAll(async () => {
  builder = new ModelBuilder(await loadOCCT());
}, 60_000);

const viewsOf = (doc: ModelDoc, sheet: DrawingSheet) => {
  const model = { ...doc };
  delete model.drawings;
  const got = new Map<string, ModelView>(sheet.views.map((v) => [v.id, builder.view(model, undefined, viewRequest(v), projectView)]));
  return (id: string) => got.get(id);
};
const counter = () => {
  let n = 0;
  return (kind: "dm" | "mk") => `${kind}${++n}`;
};

/** The fixture as it is made: its model, three views and Auto dimension run on them. */
function made(f: Fixture): ModelDoc {
  const doc = f.model();
  const views: DrawingView[] = f.views.map((v) => ({
    id: v.id,
    kind: "base",
    shows: { all: true },
    direction: v.direction,
    hidden: true,
    tangent: false,
    at: v.at,
  }));
  const blank: DrawingSheet = { ...newSheet("Sheet 1", { size: f.size, title: doc.name, date: "2026-11-23" }), id: "sh1", scale: f.scale, views };
  const viewOf = viewsOf(doc, blank);
  const sheet = stamp(autoDimension(blank, viewOf, 2, f.auto, counter()).sheet, viewOf, 2);
  const drawing: Drawing = { id: "dr1", name: "Drawing 1", decimals: 2, sheets: [sheet] };
  return { ...doc, drawings: [drawing] };
}
const path = (f: Fixture, ext = ".bcad") => join(DIR, `${f.file}${ext}`);
function opened(f: Fixture): { doc: ModelDoc; sheet: DrawingSheet; viewOf: (id: string) => ModelView | undefined } {
  const loaded = loadBcad(readFileSync(path(f), "utf8"));
  if (loaded instanceof BcadError) throw new Error(`${f.file}: ${loaded.message}`);
  const sheet = loaded.doc.drawings![0]!.sheets[0]!;
  return { doc: loaded.doc, sheet, viewOf: viewsOf(loaded.doc, sheet) };
}

describe.each(FIXTURES.map((f) => [f.file, f] as const))("fixture drawing: %s", (_name, f) => {
  it("is the drawing its recipe makes", () => {
    const text = saveBcad(made(f), { now: WHEN, created: WHEN.toISOString(), id: f.file });
    if (UPDATE || !existsSync(path(f))) {
      if (!UPDATE && process.env.CI) throw new Error(`No fixtures/drawings/${f.file}.bcad. Run UPDATE_GOLDEN=1 npm run test:golden and commit it.`);
      writeFileSync(path(f), text);
    }
    expect(JSON.parse(readFileSync(path(f), "utf8")).document).toEqual(JSON.parse(text).document);
  }, 60_000);

  it("opens with every view drawn and every mark and dimension still fixed to the model", () => {
    const { sheet, viewOf } = opened(f);
    expect(sheet.standard).toBe(f.size === "A3" ? "iso" : "asme");
    for (const v of sheet.views) expect(viewOf(v.id)!.edges.length, v.id).toBeGreaterThan(3);
    expect(sheet.dimensions.length).toBeGreaterThan(4);
    expect(problems(sheet, viewOf, 2)).toEqual([]);
    // Nothing has changed since it was laid out, so nothing moves.
    expect(follow(sheet, viewOf, 2)).toBe(sheet);
  }, 60_000);

  it("offers the same sizes from Auto dimension as when it was made", async () => {
    const { sheet, viewOf } = opened(f);
    const bare = { ...sheet, dimensions: [], marks: [] };
    const lines: string[] = [];
    for (const recipe of ["baseline", "chain"] as const) {
      lines.push(`${recipe}, from the bottom left`);
      for (const c of candidates(bare, viewOf, { ...AUTO_START, recipe, density: 1 })) {
        const art = dimArt({ ...c.dim, at: [0, -200] }, contextOf(bare, c.dim.view, viewOf(c.dim.view)!, 2)!);
        const view = sheet.views.find((v) => v.id === c.dim.view)!.direction as string;
        lines.push(`  ${view}  ${RANKS[c.rank]}  ${art?.text.text ?? "?"}${c.dim.across ? `  ${c.dim.across === "x" ? "across" : "up"}` : ""}`);
      }
    }
    const want = path(f, ".auto.txt");
    if (UPDATE) writeFileSync(want, lines.join("\n") + "\n");
    await expect(lines.join("\n") + "\n").toMatchFileSnapshot(want);
  }, 60_000);

  // The nightly round trip: the sheet written to each format, with every line, arrowhead and letter it should have.
  it.skipIf(!process.env.NIGHTLY)(
    "writes to SVG, PDF and DXF with nothing dropped",
    () => {
      const { doc, sheet, viewOf } = opened(f);
      const scene = sheetScene(sheet, sheetLayout(sheet, { index: 1, count: 1 }), viewOf, doc.drawings![0]!.decimals);
      const of = (layer: string) => scene.strokes.filter((s) => s.layer === layer).length;
      expect(of("visible")).toBeGreaterThan(8);
      expect(of("dimension")).toBeGreaterThan(sheet.dimensions.length);
      expect(scene.fills?.length ?? 0).toBeGreaterThanOrEqual(sheet.dimensions.length);
      expect(scene.labels.filter((l) => l.layer === "dimension")).toHaveLength(sheet.dimensions.length);

      const svg = sceneSvg(scene);
      expect(svg.startsWith("<svg") || svg.startsWith("<?xml")).toBe(true);
      expect(svg.match(/<text/g)?.length ?? 0).toBe(scene.labels.length);
      for (const l of scene.labels.filter((x) => x.layer === "dimension")) expect(svg).toContain(`>${l.text.replace(/&/g, "&amp;")}<`);

      const dxf = sceneDxf(scene);
      expect(dxf.endsWith("EOF\n") || dxf.endsWith("EOF\r\n") || dxf.trimEnd().endsWith("EOF")).toBe(true);
      expect(dxf.match(/\nTEXT\r?\n/g)?.length ?? 0).toBe(scene.labels.length);
      expect(dxf.match(/\nSOLID\r?\n/g)?.length ?? 0).toBe(scene.fills?.length ?? 0);
      for (const layer of ["VISIBLE", "HIDDEN", "DIMENSIONS"]) expect(dxf).toContain(layer);

      const content = pdfContent(scene, []);
      const pdf = new TextDecoder("latin1").decode(scenePdf(scene, []));
      expect(pdf.startsWith("%PDF-")).toBe(true);
      expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
      // Every arrowhead is a filled path.
      expect(content.match(/ h f\n/g)?.length ?? 0).toBeGreaterThanOrEqual(scene.fills?.length ?? 0);
    },
    60_000,
  );
});
