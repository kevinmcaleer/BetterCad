import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./occt/oc";
import {
  boolean,
  box,
  chamfer,
  cone,
  cylinder,
  elements,
  fillet,
  grow,
  holes,
  measure,
  place,
  polygonFace,
  prism,
  prismOf,
  pushPull,
  revolveOf,
  shell,
  sphere,
  torus,
  valid,
  wedge,
  type TopoDS_Shape,
} from "./occt/shapes";
import { bodyRef } from "./construct";
import { extent, pickProfiles, startDistance, upToDistance, type PrismSpec, type ProfileSeg } from "./extrude";
import { createRequire } from "node:module";
import { parse } from "opentype.js";
import { Draft, drawCircle, layoutText, newSketch, type GlyphFont, type PathCommand, type Sketch } from "@bettercad/sketch";
import { resolveHole, type HoleParams, type HoleSpec } from "./holes";
import { tessellate } from "./occt/tessellate";
import { readStep } from "./occt/export";
import { moved, overlapOf } from "./occt/clashes";
import { catalogueShape } from "./occt/catalogue";
import { placeOnFace } from "./catalogue";
import { cataloguePart } from "./catalogue/list";
import {
  GEAR_DEFAULTS,
  MOUNT_DEFAULTS,
  addGear,
  addMount,
  addHole,
  mirrorFace,
  addPattern,
  addPart,
  type PatternParams,
  build,
  changeParts,
  cutPocket,
  insertCatalogue,
  newDoc,
  type GearParamsStep,
  type MountParams,
} from "./document";
import { rectPattern } from "./catalogue";
import { ModelBuilder } from "./occt/model";

/** A 19 mm octagonal prism of circumradius 10 with a 1 mm, 20 mm wide disc on top: the disc's rim touches the corners. */
function discOnOctagon(oc: OC): TopoDS_Shape {
  const pts: [number, number, number][] = [...Array(8).keys()].map((i) => [10 * Math.cos((i * Math.PI) / 4), 10 * Math.sin((i * Math.PI) / 4), 0]);
  const octagon = prism(oc, polygonFace(oc, pts), [0, 0, 19]);
  const disc = place(oc, cylinder(oc, { x: 20, y: 20, z: 1 }), { position: { x: 0, y: 0, z: 19 } });
  return boolean(oc, "join", octagon, [disc]);
}

/**
 * A 5.5 mm diamond cog standing 2 mm off a flat of an octagonal rim, cut down from a real model. Joined with the usual
 * 1e-6 mm tolerance the result is not a valid solid, so a chamfer on the cog then failed on every edge.
 */
function cogOnFlat(oc: OC): TopoDS_Shape {
  const [flat, cog] = readStep(oc, readFileSync(join(dirname(fileURLToPath(import.meta.url)), "testdata", "step", "cog-on-flat.step")));
  return boolean(oc, "join", flat!.shape, [cog!.shape]);
}

/** The edge between the cog's top and one side: its number in `shape`. */
function cogTopEdge(oc: OC, shape: TopoDS_Shape): number {
  const mid = [8.1304, -14.547, 8.5555];
  return elements(oc, shape, "edge").findIndex((e) => {
    const c = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(e));
    const p = c.Value((c.FirstParameter() + c.LastParameter()) / 2);
    const hit = Math.hypot(p.X() - mid[0]!, p.Y() - mid[1]!, p.Z() - mid[2]!) < 1e-3;
    c.delete();
    return hit;
  });
}

/** A 100 × 80 × 5 mm plate with a mounting feature on its top (#189). */
function mountOn(oc: OC, params: Partial<MountParams>): TopoDS_Shape {
  let doc = changeParts(addPart(newDoc(), "box", "plate"), ["plate"], "size", { x: 100, y: 80, z: 5 });
  const frame = { origin: [0, 0, 5] as [number, number, number], x: [1, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
  doc = addMount(doc, { ...MOUNT_DEFAULTS, kind: "standoffs", part: "plate", frame, points: [[0, 0]], ...params });
  return new ModelBuilder(oc).solid(build(doc).parts.find((p) => p.id === "plate")!).shape;
}

/** A spur gear step (#191), built as the editor builds it. */
function gearOf(oc: OC, change: Partial<GearParamsStep> = {}): TopoDS_Shape {
  const doc = addGear(
    newDoc(),
    { gear: GEAR_DEFAULTS, width: 5, bore: { kind: "round", diameter: 5 }, frame: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] }, ...change },
    "g",
    "gear",
  );
  return new ModelBuilder(oc).solid(build(doc).parts.find((p) => p.id === "gear")!).shape;
}

/** A part copied by a joined Mirror or Pattern step (#69), built as the one body it becomes. */
function patterned(
  oc: OC,
  kind: "wedge" | "cylinder" | "box",
  size: { x: number; y: number; z: number },
  x: number,
  p: Partial<PatternParams> & { kind: PatternParams["kind"] },
): TopoDS_Shape {
  let doc = changeParts(addPart(newDoc(), kind, "a"), ["a"], "size", size);
  doc = changeParts(doc, ["a"], "position", { x, y: 0, z: 0 });
  doc = addPattern(doc, { parts: ["a"], join: true, ...p });
  return new ModelBuilder(oc).solid(build(doc).parts.find((q) => q.id === "a")!).shape;
}

/** A 60 × 40 × 5 mm plate with a catalogue part's pocket and holes cut in it (#188). */
function pocketIn(oc: OC, id: string): TopoDS_Shape {
  let doc = changeParts(addPart(newDoc(), "box", "plate"), ["plate"], "size", { x: 60, y: 40, z: 5 });
  doc = insertCatalogue(doc, cataloguePart(id)!, placeOnFace([0, 0, 5], [0, 0, 1], [1, 0, 0]), "part");
  doc = cutPocket(doc, "part", { target: "plate" }).doc;
  return new ModelBuilder(oc).solid(build(doc).parts.find((p) => p.id === "plate")!).shape;
}
import { meshVolume, triangleCount } from "./mesh";

/**
 * Golden tests (#49): every kernel operation, measured from the exact B-rep and checked against a stored answer in
 * golden/. A change to OCCT, the build or an operation that moves a number shows up here. To accept a deliberate
 * change, run `UPDATE_GOLDEN=1 npm run test:golden` and commit the new files.
 */
const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "golden");
const UPDATE = !!process.env.UPDATE_GOLDEN;

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

const XY = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] } as PrismSpec["frame"];
const rect = (w: number, h: number): ProfileSeg[] => [
  { kind: "line", a: [0, 0], b: [w, 0] },
  { kind: "line", a: [w, 0], b: [w, h] },
  { kind: "line", a: [w, h], b: [0, h] },
  { kind: "line", a: [0, h], b: [0, 0] },
];

const XZ = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, -1, 0] } as PrismSpec["frame"];
const Z_AXIS = { origin: [0, 0] as [number, number], dir: [0, 1] as [number, number] };
const rectAt = (x: number, y: number, w: number, h: number): ProfileSeg[] =>
  rect(w, h).map((g) => (g.kind === "line" ? { kind: "line", a: [g.a[0] + x, g.a[1] + y], b: [g.b[0] + x, g.b[1] + y] } : g));

const holeOn = (top: number, p: HoleParams): HoleSpec => {
  const r = resolveHole(p) as { diameter: number; head?: HoleSpec["head"] };
  return { frame: { origin: [0, 0, top], x: [1, 0, 0], normal: [0, 0, 1] }, points: [[0, 0]], depth: p.depth, ...r };
};

/** Text in Inter (the app's default font), 10 mm capitals, picked whole: letters with holes and a gap between lines. */
/**
 * A 40 × 20 face's projected outline with a 10 mm circle touching its top, bottom and right edges: cut where they
 * meet, the two corners outside the circle are regions of their own.
 */
function cornerSketch(): Sketch {
  const d = new Draft(newSketch());
  const c = [d.point([0, 0], true), d.point([40, 0], true), d.point([40, 20], true), d.point([0, 20], true)];
  for (let i = 0; i < 4; i++) d.line(c[i]!, c[(i + 1) % 4]!, { construction: true });
  const s = d.done().sketch;
  const face = { ...s, entities: s.entities.map((e) => (e.kind === "line" ? { ...e, projectedFrom: { body: "b", face: 0 } } : e)) };
  return drawCircle(face, [30, 10], 10).sketch;
}

function textSketch(text: string): Sketch {
  const b = readFileSync(createRequire(import.meta.url).resolve("@fontsource/inter/files/inter-latin-400-normal.woff"));
  const f = parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const font: GlyphFont = {
    unitsPerEm: f.unitsPerEm,
    capHeight: (f.tables.os2 as unknown as { sCapHeight: number }).sCapHeight,
    ascender: f.ascender,
    descender: f.descender,
    lineGap: (f.tables.hhea as unknown as { lineGap: number }).lineGap,
    glyph: (ch) => {
      const g = f.charToGlyph(ch);
      return { advance: g.advanceWidth ?? 0, commands: g.path.commands as PathCommand[] };
    },
    kerning: (l, r) => f.getKerningValue(f.charToGlyph(l), f.charToGlyph(r)),
  };
  const style = { text, font: "inter", height: 10, angle: 15, letterSpacing: 0.5, lineSpacing: 1.2 };
  return {
    ...newSketch(),
    entities: [{ id: "p", kind: "point", x: -10, y: 0 }],
    texts: [{ id: "t", p: "p", ...style, loops: layoutText(font, style) }],
  };
}

const cases: Record<string, (oc: OC) => TopoDS_Shape> = {
  box: (oc) => box(oc, { x: 20, y: 10, z: 5 }),
  cylinder: (oc) => cylinder(oc, { x: 20, y: 20, z: 30 }),
  "cylinder-elliptical": (oc) => cylinder(oc, { x: 20, y: 10, z: 30 }),
  sphere: (oc) => sphere(oc, { x: 20, y: 20, z: 20 }),
  spheroid: (oc) => sphere(oc, { x: 20, y: 20, z: 40 }),
  cone: (oc) => cone(oc, 20, 10, 15),
  torus: (oc) => torus(oc, 40, 10),
  wedge: (oc) => wedge(oc, { x: 20, y: 10, z: 10 }),
  placed: (oc) => place(oc, box(oc, { x: 20, y: 10, z: 5 }), { position: { x: 5, y: -3, z: 2 }, rotation: { x: 30, y: 0, z: 45 } }),
  join: (oc) => boolean(oc, "join", box(oc, { x: 20, y: 20, z: 20 }), [place(oc, cylinder(oc, { x: 10, y: 10, z: 30 }), { position: { x: 10, y: 0, z: 0 } })]),
  cut: (oc) => boolean(oc, "cut", box(oc, { x: 20, y: 20, z: 20 }), [cylinder(oc, { x: 10, y: 10, z: 30 })]),
  intersect: (oc) => boolean(oc, "intersect", box(oc, { x: 20, y: 20, z: 20 }), [sphere(oc, { x: 24, y: 24, z: 24 })]),
  fillet: (oc) => fillet(oc, box(oc, { x: 20, y: 20, z: 20 }), [0, 1, 2, 3], 3),
  chamfer: (oc) => chamfer(oc, box(oc, { x: 20, y: 20, z: 20 }), [0, 1, 2, 3], 2),
  shell: (oc) => shell(oc, box(oc, { x: 20, y: 20, z: 20 }), [0], 2),
  // Extrude (#61): a sketch's closed shapes pushed along its normal.
  "extrude-rect": (oc) => prismOf(oc, { frame: XY, profiles: [{ outer: rect(30, 20), holes: [], area: 600 }], from: 0, to: 10 }),
  "extrude-ring": (oc) =>
    prismOf(oc, {
      frame: XY,
      profiles: [{ outer: [{ kind: "circle", c: [0, 0], r: 10 }], holes: [[{ kind: "circle", c: [0, 0], r: 4 }]], area: 0 }],
      from: 0,
      to: 5,
    }),
  "extrude-arc": (oc) =>
    prismOf(oc, {
      frame: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, -1, 0] },
      profiles: [
        {
          outer: [
            { kind: "line", a: [-10, 0], b: [10, 0] },
            { kind: "arc", a: [10, 0], m: [0, 10], b: [-10, 0] },
          ],
          holes: [],
          area: 0,
        },
      ],
      from: -4,
      to: 4,
    }),
  // Finishes (#67, #68): every edge of a cube rounded; a tray with a 1.2 mm wall; a shell grown outward.
  "fillet-all": (oc) => fillet(oc, box(oc, { x: 20, y: 20, z: 20 }), [...Array(12).keys()], 2),
  // A rim whose corners OpenCascade cannot close on its own: a 1 mm disc on an octagon whose corners touch the rim.
  // Edge 15 is one of the eight arcs under the disc; the round runs right round and out over the corners.
  "fillet-rim-on-octagon": (oc) => fillet(oc, discOnOctagon(oc), [15], 0.5),
  "chamfer-rim-on-octagon": (oc) => chamfer(oc, discOnOctagon(oc), [15], 0.5),
  "join-cog-on-flat": cogOnFlat,
  "chamfer-cog-on-flat": (oc) => {
    const s = cogOnFlat(oc);
    return chamfer(oc, s, [cogTopEdge(oc, s)], 1);
  },
  "chamfer-all": (oc) => chamfer(oc, box(oc, { x: 20, y: 20, z: 20 }), [...Array(12).keys()], 1),
  tray: (oc) => shell(oc, fillet(oc, box(oc, { x: 40, y: 30, z: 15 }), [...Array(12).keys()], 3), [], 1.2),
  "hollow-sphere": (oc) => shell(oc, sphere(oc, { x: 20, y: 20, z: 20 }), [], 1),
  "shell-outside": (oc) => shell(oc, box(oc, { x: 20, y: 20, z: 20 }), [5], 2, true),
  // Revolve (#62): a 10 × 30 mm rectangle beside the Z axis, a full turn and a quarter; a groove cut into a cylinder.
  "revolve-full": (oc) => revolveOf(oc, { frame: XZ, profiles: [{ outer: rectAt(5, 0, 10, 30), holes: [], area: 300 }], axis: Z_AXIS, angle: 360 }),
  "revolve-quarter": (oc) => revolveOf(oc, { frame: XZ, profiles: [{ outer: rectAt(5, 0, 10, 30), holes: [], area: 300 }], axis: Z_AXIS, angle: 90 }),
  "revolve-groove": (oc) =>
    boolean(oc, "cut", cylinder(oc, { x: 20, y: 20, z: 30 }), [
      revolveOf(oc, { frame: XZ, profiles: [{ outer: rectAt(8, 10, 4, 4), holes: [], area: 16 }], axis: Z_AXIS, angle: 360 }),
    ]),
  // Revolve round an axis 10 mm off the sketch's plane (a construction axis or an edge above it).
  "revolve-offset-axis": (oc) =>
    revolveOf(oc, { frame: XZ, profiles: [{ outer: rectAt(5, 0, 10, 30), holes: [], area: 300 }], axis: { ...Z_AXIS, offset: 10 }, angle: 360 }),
  // Push/pull (#65): the top of a 20 mm box out 5 mm, and in 5 mm.
  "pushpull-out": (oc) => pushPull(oc, box(oc, { x: 20, y: 20, z: 20 }), 5, 5),
  "pushpull-in": (oc) => pushPull(oc, box(oc, { x: 20, y: 20, z: 20 }), 5, -5),
  // Holes (#70), into the top of a plate.
  "hole-m3-plate": (oc) => holes(oc, box(oc, { x: 20, y: 20, z: 5 }), holeOn(5, { size: "M3", fit: "printed", head: "none", depth: null })),
  "hole-m3-countersunk": (oc) => holes(oc, box(oc, { x: 20, y: 20, z: 5 }), holeOn(5, { size: "M3", fit: "printed", head: "countersink", depth: null })),
  "hole-m4-counterbore": (oc) => holes(oc, box(oc, { x: 20, y: 20, z: 10 }), holeOn(10, { size: "M4", fit: "printed", head: "counterbore", depth: 6 })),
  // Group (#66): a box with two hole cylinders is the box less both.
  group: (oc) =>
    boolean(oc, "cut", box(oc, { x: 40, y: 20, z: 10 }), [
      place(oc, cylinder(oc, { x: 6, y: 6, z: 10 }), { position: { x: -10, y: 0, z: 0 } }),
      place(oc, cylinder(oc, { x: 6, y: 6, z: 10 }), { position: { x: 10, y: 0, z: 0 } }),
    ]),
  // Cut with a fit (#183): a 10 mm cube and a 6 mm peg cut out of a plate with a 0.25 mm sliding gap.
  "fit-cube-sliding": (oc) =>
    boolean(oc, "cut", box(oc, { x: 30, y: 30, z: 10 }), [grow(oc, place(oc, box(oc, { x: 10, y: 10, z: 10 }), { position: { x: 0, y: 0, z: 5 } }), 0.25)]),
  "fit-peg-sliding": (oc) => boolean(oc, "cut", box(oc, { x: 20, y: 20, z: 10 }), [grow(oc, cylinder(oc, { x: 6, y: 6, z: 20 }), 0.25)]),
  // Catalogue parts (#186): a servo's blocks joined, and a bearing with its bore taken out.
  "catalogue-sg90": (oc) => catalogueShape(oc, cataloguePart("sg90")!),
  "catalogue-608": (oc) => catalogueShape(oc, cataloguePart("608")!),
  // Cut pocket (#188): an SG90's pocket at a sliding fit and its M2 holes through a 5 mm plate; a Pico's four holes.
  "pocket-sg90-plate": (oc) => pocketIn(oc, "sg90"),
  "pocket-pico-holes": (oc) => pocketIn(oc, "pico"),
  // Mounting features (#189): M2.5 standoffs on a Pi's 58 × 49 mm pattern, through and with inserts; a cross horn.
  "standoffs-pi-through": (oc) => mountOn(oc, { points: rectPattern(58, 49), size: "M2.5", height: 6, outer: 6 }),
  "standoffs-pi-insert": (oc) => mountOn(oc, { points: rectPattern(58, 49), size: "M2.5", height: 6, outer: 6, hole: "insert" }),
  "horn-cross": (oc) => mountOn(oc, { kind: "horn", horn: "cross", size: "M2" }),
  "gear-20t-m1": (oc) => gearOf(oc),
  "gear-12t-shifted-dflat-hub": (oc) =>
    gearOf(oc, {
      gear: { ...GEAR_DEFAULTS, teeth: 12, module: 1.5, shift: 0.3 },
      bore: { kind: "dflat", diameter: 5, flat: 2 },
      hub: { diameter: 10, length: 4 },
    }),
  "rack-m1-60": (oc) => gearOf(oc, { form: "rack", rack: { length: 60, height: 5 }, bore: { kind: "none", diameter: 0 } }),
  "gt2-20t-flanged": (oc) => gearOf(oc, { form: "gt2", gear: { ...GEAR_DEFAULTS, teeth: 20 }, width: 7, flanges: true }),
  "gear-40t-horn": (oc) => gearOf(oc, { gear: { ...GEAR_DEFAULTS, teeth: 40 }, bore: { kind: "horn", diameter: 7, arm: 9 } }),
  // Mirror and patterns (#69), joined into one body: a wedge and its mirror image meet at the YZ plane; a 3 × 2 grid of
  // 6 mm pegs; six arms round Z.
  "mirror-wedge": (oc) => patterned(oc, "wedge", { x: 20, y: 10, z: 10 }, 10, { kind: "mirror", plane: "YZ" }),
  // Mirror (#69): a wedge mirrored across its own end face and joined (the same as mirror-wedge); a hole mirrored onto the same plate across YZ.
  "mirror-face-wedge": (oc) =>
    patterned(oc, "wedge", { x: 20, y: 10, z: 10 }, 10, {
      kind: "mirror",
      face: mirrorFace({ id: "a", position: { x: 10, y: 0, z: 0 } }, 0, { x: 0, y: 0, z: 5 }, { x: -1, y: 0, z: 0 }),
    }),
  "mirror-hole-feature": (oc) => {
    let doc = changeParts(addPart(newDoc(), "box", "b"), ["b"], "size", { x: 40, y: 20, z: 10 });
    doc = addHole(
      doc,
      { part: "b", frame: { origin: [0, 0, 10], x: [1, 0, 0], normal: [0, 0, 1] }, points: [[12, 0]], size: "M3", fit: "printed", head: "none", depth: null },
      "h",
    );
    doc = addPattern(doc, { parts: [], kind: "mirror", of: "features", features: ["h"], plane: "YZ" });
    return new ModelBuilder(oc).solid(build(doc).parts[0]!).shape;
  },
  // Mirror a mirror: an M3 hole mirrored across YZ, then the hole and that mirror mirrored across XZ, for four holes.
  "mirror-of-mirror": (oc) => {
    let doc = changeParts(addPart(newDoc(), "box", "b"), ["b"], "size", { x: 40, y: 20, z: 10 });
    doc = addHole(
      doc,
      { part: "b", frame: { origin: [0, 0, 10], x: [1, 0, 0], normal: [0, 0, 1] }, points: [[12, 5]], size: "M3", fit: "printed", head: "none", depth: null },
      "h",
    );
    doc = addPattern(doc, { parts: [], kind: "mirror", of: "features", features: ["h"], plane: "YZ" }, "m1");
    doc = addPattern(doc, { parts: [], kind: "mirror", of: "features", features: ["h", "m1"], plane: "XZ" }, "m2");
    return new ModelBuilder(oc).solid(build(doc).parts[0]!).shape;
  },
  // Pattern of features: the same M3 hole copied 3 times along X, 10 mm apart, then twice round Z, on one plate.
  "pattern-hole-features": (oc) => {
    let doc = changeParts(addPart(newDoc(), "box", "b"), ["b"], "size", { x: 40, y: 20, z: 10 });
    doc = addHole(
      doc,
      { part: "b", frame: { origin: [0, 0, 10], x: [1, 0, 0], normal: [0, 0, 1] }, points: [[15, 5]], size: "M3", fit: "printed", head: "none", depth: null },
      "h",
    );
    doc = addPattern(doc, { parts: [], kind: "rect", of: "features", features: ["h"], count1: 3, spacing1: -10 }, "r");
    doc = addPattern(doc, { parts: [], kind: "circle", of: "features", features: ["h"], count: 2 }, "c");
    return new ModelBuilder(oc).solid(build(doc).parts[0]!).shape;
  },
  "pattern-rect-pegs": (oc) => patterned(oc, "cylinder", { x: 6, y: 6, z: 10 }, 0, { kind: "rect", count1: 3, spacing1: 10, count2: 2, spacing2: 10 }),
  "pattern-circle-arms": (oc) => patterned(oc, "box", { x: 20, y: 4, z: 3 }, 12, { kind: "circle", count: 6, angle: 360 }),
  // Arms turned round a hub's round top edge, off the origin: the copies circle the hub, not Z.
  "pattern-circle-round-edge": (oc) => {
    let doc = changeParts(addPart(newDoc(), "cylinder", "hub"), ["hub"], "size", { x: 10, y: 10, z: 6 });
    doc = changeParts(doc, ["hub"], "position", { x: 30, y: 10, z: 0 });
    doc = changeParts(addPart(doc, "box", "a"), ["a"], "size", { x: 20, y: 4, z: 3 });
    doc = changeParts(doc, ["a"], "position", { x: 42, y: 10, z: 0 });
    const hub = build(doc).parts.find((q) => q.id === "hub")!;
    const axisRef = bodyRef(hub, "edge", 0, { t: "circle", centre: [30, 10, 6], axis: [0, 0, 1], radius: 5 });
    doc = addPattern(doc, { parts: ["a"], kind: "circle", count: 6, angle: 360, join: true, axisRef });
    return new ModelBuilder(oc).solid(build(doc).parts.find((q) => q.id === "a")!).shape;
  },
  // Track (Pattern's Track kind): a 10 × 4 × 2 mm piece with pins 8 mm apart wrapped round two 40 mm wheels, 2 mm out.
  // 42 go round; the fifth piece is on the first wheel's round end, turned to follow it.
  "pattern-track-two-wheels": (oc) => {
    let doc = changeParts(addPart(newDoc(), "cylinder", "w1"), ["w1"], "size", { x: 40, y: 40, z: 10 });
    doc = changeParts(addPart(doc, "cylinder", "w2"), ["w2"], "size", { x: 40, y: 40, z: 10 });
    doc = changeParts(doc, ["w2"], "position", { x: 100, y: 0, z: 0 });
    doc = changeParts(addPart(doc, "box", "link"), ["link"], "size", { x: 10, y: 4, z: 2 });
    doc = changeParts(doc, ["link"], "position", { x: 50, y: 60, z: 4 });
    const parts = build(doc).parts;
    const p = (id: string) => parts.find((q) => q.id === id)!;
    const circle = (centre: [number, number, number], radius: number) => ({
      t: "circle" as const,
      centre,
      axis: [0, 0, 1] as [number, number, number],
      radius,
    });
    doc = addPattern(
      doc,
      {
        kind: "track",
        parts: ["link"],
        track: {
          count: 42,
          start: bodyRef(p("link"), "edge", 0, circle([46, 60, 5], 1)),
          end: bodyRef(p("link"), "edge", 1, circle([54, 60, 5], 1)),
          wheels: [bodyRef(p("w1"), "edge", 0, circle([0, 0, 5], 20)), bodyRef(p("w2"), "edge", 0, circle([100, 0, 5], 20))],
          offset: 0,
          lift: 2,
          side: 0,
        },
      },
      "t",
    );
    return new ModelBuilder(oc).solid(build(doc).parts.find((q) => q.id === "t.link.3")!).shape;
  },
  "extrude-cut": (oc) =>
    boolean(oc, "cut", box(oc, { x: 20, y: 20, z: 20 }), [
      prismOf(oc, {
        frame: { origin: [0, 0, 20], x: [1, 0, 0], normal: [0, 0, 1] },
        profiles: [{ outer: [{ kind: "circle", c: [0, 0], r: 3 }], holes: [], area: 0 }],
        from: -8,
        to: 0,
      }),
    ]),
  // Through all (#61): a 3 mm circle pushed down from the top as far as THROUGH_ALL goes, leaving a hole right through.
  // Text (sketch Text tool): "B8o" over "Hi", extruded 2 mm; B, 8 and o keep their holes.
  "extrude-text": (oc) => prismOf(oc, { frame: XY, profiles: pickProfiles(textSketch("B8o\nHi"), [], ["t"]).shapes, from: 0, to: 2 }),
  // Regions cut where curves cross: the corners outside the circle, cut from a 40 × 20 × 10 block, round its end.
  "extrude-cut-split-corners": (oc) =>
    boolean(oc, "cut", place(oc, box(oc, { x: 40, y: 20, z: 10 }), { position: { x: 20, y: 10, z: 0 } }), [
      prismOf(oc, {
        frame: XY,
        profiles: pickProfiles(
          cornerSketch(),
          [
            [39, 19],
            [39, 1],
          ],
          [],
          true,
        ).shapes,
        from: 0,
        to: 10,
      }),
    ]),
  "extrude-cut-through-all": (oc) =>
    boolean(oc, "cut", box(oc, { x: 20, y: 20, z: 20 }), [
      prismOf(oc, {
        frame: { origin: [0, 0, 20], x: [1, 0, 0], normal: [0, 0, 1] },
        profiles: [{ outer: [{ kind: "circle", c: [0, 0], r: 3 }], holes: [], area: 0 }],
        ...extent("one", -1, 0, true),
      }),
    ]),
  // Clash check (#178): what two 20 mm boxes 12 mm apart share, an 8 × 20 × 20 block, 3200 mm³.
  "clash-overlap": (oc) => overlapOf(oc, box(oc, { x: 20, y: 20, z: 20 }), place(oc, box(oc, { x: 20, y: 20, z: 20 }), { position: { x: 12, y: 0, z: 0 } }))!,
  // Clash sweep (#179): a 20 mm block on a slider run 15 mm back into a 20 mm box shares a 5 × 20 × 20 block, 2000 mm³.
  "clash-sweep-slide": (oc) =>
    overlapOf(
      oc,
      box(oc, { x: 20, y: 20, z: 20 }),
      moved(oc, place(oc, box(oc, { x: 20, y: 20, z: 20 }), { position: { x: 30, y: 0, z: 0 } }), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -15, 0, 0, 1]),
    )!,
  // To object: a 3 mm circle pushed down from the top until it meets a flat face 6 mm up from the bottom.
  "extrude-cut-to-face": (oc) => {
    const frame = { origin: [0, 0, 20] as [number, number, number], x: [1, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
    const to = upToDistance(frame, [0, 0], { point: [10, 10, 6], normal: [0, 0, 1] }) as number;
    return boolean(oc, "cut", box(oc, { x: 20, y: 20, z: 20 }), [
      prismOf(oc, { frame, profiles: [{ outer: [{ kind: "circle", c: [0, 0], r: 3 }], holes: [], area: 0 }], ...extent("one", to) }),
    ]);
  },
  // Start Object: the same circle starting level with a face 14 mm up and cut 4 mm on from there, a pocket below the top.
  "extrude-cut-start-object": (oc) => {
    const frame = { origin: [0, 0, 20] as [number, number, number], x: [1, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
    const start = startDistance({ start: "object", from: { body: "b", kind: "face", point: [10, 10, 14], normal: [0, 0, 1] } }, frame, [0, 0], () => ({
      position: { x: 0, y: 0, z: 0 },
    })) as number;
    const span = extent("one", -4);
    return boolean(oc, "cut", box(oc, { x: 20, y: 20, z: 20 }), [
      prismOf(oc, { frame, profiles: [{ outer: [{ kind: "circle", c: [0, 0], r: 3 }], holes: [], area: 0 }], from: span.from + start, to: span.to + start }),
    ]);
  },
};

const round = (v: unknown): unknown =>
  typeof v === "number"
    ? Math.round(v * 1e4) / 1e4
    : Array.isArray(v)
      ? v.map(round)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]))
        : v;

describe("golden geometry", () => {
  for (const [name, make] of Object.entries(cases)) {
    // Gears and other many-faced bodies take a few seconds on a busy runner.
    it(
      name,
      () => {
        const shape = make(oc);
        expect(valid(oc, shape)).toBe(true);
        const m = measure(oc, shape);
        const mesh = tessellate(oc, shape, "fine");
        // The fine mesh is what export writes: it must hold the solid's volume to within 0.5 %.
        expect(Math.abs(meshVolume(mesh) - m.volume) / m.volume).toBeLessThan(0.005);
        const got = round({ ...m, triangles: triangleCount(mesh) > 0 }) as Record<string, unknown>;
        const file = join(DIR, `${name}.json`);
        if (UPDATE || !existsSync(file)) {
          if (!UPDATE && process.env.CI) throw new Error(`No golden file for ${name}. Run UPDATE_GOLDEN=1 npm run test:golden and commit it.`);
          mkdirSync(DIR, { recursive: true });
          writeFileSync(file, JSON.stringify(got, null, 2) + "\n");
          return;
        }
        const want = JSON.parse(readFileSync(file, "utf8")) as typeof got;
        // Every number that moved, before and after, for the CI job summary (GOLDEN_SUMMARY names the file).
        const moved: [string, unknown, unknown][] = [];
        const diff = (a: unknown, b: unknown, path: string): void => {
          if (typeof b === "number") {
            if (typeof a !== "number" || Math.abs(a - b) >= 5e-4) moved.push([path, b, a]);
          } else if (b && typeof b === "object") for (const [k, x] of Object.entries(b)) diff((a as Record<string, unknown>)?.[k], x, `${path}.${k}`);
          else if (JSON.stringify(a) !== JSON.stringify(b)) moved.push([path, b, a]);
        };
        diff(got, want, name);
        if (moved.length && process.env.GOLDEN_SUMMARY) {
          const rows = moved.map(([p, b, a]) => `| \`${p}\` | ${JSON.stringify(b)} | ${JSON.stringify(a)} |`).join("\n");
          appendFileSync(process.env.GOLDEN_SUMMARY, `\n#### ${name}\n\n| Measure | Golden | Now |\n| --- | --- | --- |\n${rows}\n`);
        }
        expect(moved.map(([p, b, a]) => `${p}: ${JSON.stringify(b)} → ${JSON.stringify(a)}`)).toEqual([]);
      },
      20_000,
    );
  }
});
