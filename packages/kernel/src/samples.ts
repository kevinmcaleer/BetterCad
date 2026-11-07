import { newDoc, type Feature, type ModelDoc, type PartKind, type Vec3 } from "./document";
import type { Parameter } from "./params";

/**
 * Sample models (#99), built from the document API so they follow the format when it changes. Each one is driven by
 * parameters (#75), so the first edit can be a number in the Parameters panel. `npm run build:samples` writes them to
 * web/public/samples/ with thumbnails; the kernel tests build them as regression fixtures.
 */
export interface SampleInfo {
  id: string;
  name: string;
  /** One line under the card, in the brand book's voice. */
  blurb: string;
  build: () => ModelDoc;
  /** Shown on the sample cards; false for a utility, opened from where it's needed. */
  card?: boolean;
}

/** Writes a sample's timeline with stable ids, so the files only change when the model does. */
class Sample {
  doc: ModelDoc;
  private n = 0;
  constructor(name: string) {
    this.doc = newDoc(name);
  }
  private push(f: Feature extends infer F ? (F extends Feature ? Omit<F, "id"> : never) : never): string {
    const id = `f${++this.n}`;
    this.doc.features.push({ ...f, id } as Feature);
    return id;
  }
  param(name: string, expression: string, comment: string, unit: Parameter["unit"] = "mm") {
    this.doc.params = [...(this.doc.params ?? []), { id: `p_${name}`, name, expression, unit, comment }];
  }
  /** A primitive sized and placed by expressions (an Add, then a Resize and a Move that use the parameters). */
  part(id: string, name: string, kind: PartKind, size: Record<keyof Vec3, string>, at: Partial<Record<keyof Vec3, string>> = {}, turn?: Partial<Vec3>) {
    this.push({ type: "add", name: `Add ${name}`, part: { id, name, kind, position: { x: 0, y: 0, z: 0 }, size: { x: 10, y: 10, z: 10 } } });
    this.push({
      type: "resize",
      name: `Size ${name}`,
      parts: [id],
      size: { x: 10, y: 10, z: 10 },
      exprs: { "size.x": size.x, "size.y": size.y, "size.z": size.z },
    });
    const exprs = Object.fromEntries(Object.entries(at).map(([k, v]) => [`position.${k}`, v]));
    if (Object.keys(exprs).length || turn) {
      this.push({
        type: "move",
        name: `Place ${name}`,
        parts: [id],
        position: { x: 0, y: 0, z: 0 },
        rotation: turn,
        exprs: Object.keys(exprs).length ? exprs : undefined,
      });
    }
  }
  hole(id: string) {
    this.doc.looks[id] = { ...this.doc.looks[id], hole: true };
  }
  group(name: string, target: string, tools: { id: string; op: "join" | "cut" }[]) {
    this.push({ type: "combine", name, mode: "group", target, tools });
  }
  shell(name: string, part: string, open: number[], wall: string) {
    this.push({ type: "shell", name, part, refs: open, size: 2, exprs: { size: wall } });
  }
}

/** Box faces as the kernel numbers them: 0 −X, 1 +X, 2 −Y, 3 +Y, 4 bottom, 5 top. */
const TOP = 5;

function boxWithLid(): ModelDoc {
  const s = new Sample("Box with a lid");
  s.param("width", "60", "Outside, left to right");
  s.param("depth", "40", "Outside, front to back");
  s.param("height", "30", "Outside, without the lid");
  s.param("wall", "2", "Wall and lid thickness");
  s.param("gap", "0.3", "Room between the lid's lip and the walls, so it fits after printing");
  s.part("box", "Box", "box", { x: "width", y: "depth", z: "height" });
  s.shell("Hollow the box", "box", [TOP], "wall");
  // The lid prints upside down beside the box: a plate with a lip that drops inside the walls.
  s.part("lid", "Lid", "box", { x: "width", y: "depth", z: "wall" }, { x: "width + 10" });
  s.part("lip", "Lip", "box", { x: "width - 2 * wall - 2 * gap", y: "depth - 2 * wall - 2 * gap", z: "4" }, { x: "width + 10", z: "wall" });
  s.group("Lid with lip", "lid", [{ id: "lip", op: "join" }]);
  return s.doc;
}

function bracket(): ModelDoc {
  const s = new Sample("Bracket");
  s.param("width", "30", "Across the bracket");
  s.param("leg", "40", "Length of each leg");
  s.param("thickness", "4", "Plate thickness");
  s.param("hole", "4.5", "Hole diameter: 4.5 mm clears an M4 screw");
  s.part("base", "Bracket", "box", { x: "leg", y: "width", z: "thickness" });
  s.part("upright", "Upright", "box", { x: "thickness", y: "width", z: "leg" }, { x: "thickness / 2 - leg / 2" });
  s.part("hole1", "Base hole", "cylinder", { x: "hole", y: "hole", z: "thickness + 2" }, { x: "thickness / 2", z: "-1" });
  // Turned to lie along X, through the upright.
  s.part("hole2", "Upright hole", "cylinder", { x: "hole", y: "hole", z: "thickness + 2" }, { x: "-leg / 2 - 1", z: "(leg + thickness) / 2" }, { y: 90 });
  s.hole("hole1");
  s.hole("hole2");
  s.group("L bracket", "base", [
    { id: "upright", op: "join" },
    { id: "hole1", op: "cut" },
    { id: "hole2", op: "cut" },
  ]);
  return s.doc;
}

function phoneStand(): ModelDoc {
  const s = new Sample("Phone stand");
  s.param("width", "70", "Across the stand");
  s.param("height", "50", "How high the back rest reaches");
  s.param("lean", "50", "How far the back rest leans: the same as height is 45°, more leans further back");
  s.param("shelf", "14", "Room for the phone in its case");
  s.param("base", "4", "Base thickness");
  // One piece that prints flat: the slope faces up, so nothing overhangs and it needs no supports.
  s.part("stand", "Phone stand", "box", { x: "lean + shelf + 4", y: "width", z: "base" });
  s.part("rest", "Back rest", "wedge", { x: "lean", y: "width", z: "height" }, { x: "lean / 2 - (lean + shelf + 4) / 2", z: "base" });
  s.part("lip", "Lip", "box", { x: "4", y: "width", z: "base + 8" }, { x: "(lean + shelf + 4) / 2 - 2" });
  s.group("Phone stand", "stand", [
    { id: "rest", op: "join" },
    { id: "lip", op: "join" },
  ]);
  return s.doc;
}

/** Offsets the coupon tries, mm, one column each from the left. */
export const CALIBRATION_OFFSETS = [0.2, 0.3, 0.4, 0.5, 0.6] as const;
/** Sizes, one row each from the front. */
export const CALIBRATION_SIZES = [2, 3, 4, 5, 6] as const;

/**
 * The hole calibration coupon (#104): M2 to M6 holes (rows, front to back) at offsets 0.2 to 0.6 mm (columns, left
 * to right). The notches on the front edge count the column: one notch is 0.2 mm, five is 0.6 mm. Print it flat, try
 * a screw in each row, and set the Print panel's hole offset to the first column it slides through.
 */
function holeCalibration(): ModelDoc {
  const s = new Sample("Hole calibration");
  s.param("pitch", "14", "Between hole centres");
  s.param("thickness", "3", "Plate thickness");
  s.param("edge", "5", "Plate edge past the outer holes");
  const n = CALIBRATION_OFFSETS.length;
  s.part("plate", "Plate", "box", { x: `${n - 1} * pitch + 2 * edge + 6`, y: `${CALIBRATION_SIZES.length - 1} * pitch + 2 * edge + 10`, z: "thickness" });
  const tools: { id: string; op: "cut" }[] = [];
  const col = (i: number) => `(${i} - ${(n - 1) / 2}) * pitch`;
  CALIBRATION_SIZES.forEach((d, j) => {
    CALIBRATION_OFFSETS.forEach((o, i) => {
      const id = `m${d}_${i}`;
      s.part(
        id,
        `M${d} + ${o} mm`,
        "cylinder",
        { x: `${d} + ${o}`, y: `${d} + ${o}`, z: "thickness + 2" },
        { x: col(i), y: `(${j} - ${(CALIBRATION_SIZES.length - 1) / 2}) * pitch + 2`, z: "-1" },
      );
      s.hole(id);
      tools.push({ id, op: "cut" });
    });
  });
  // Notches along the front edge: one for the first column, up to five for the last.
  CALIBRATION_OFFSETS.forEach((_, i) => {
    for (let k = 0; k <= i; k++) {
      const id = `notch${i}_${k}`;
      s.part(
        id,
        `Notch ${i + 1}.${k + 1}`,
        "box",
        { x: "1", y: "3", z: "thickness + 2" },
        {
          x: `${col(i)} + ${(k - i / 2) * 2}`,
          y: `-(${CALIBRATION_SIZES.length - 1} * pitch + 2 * edge + 10) / 2`,
          z: "-1",
        },
      );
      s.hole(id);
      tools.push({ id, op: "cut" });
    }
  });
  s.group("Calibration plate", "plate", tools);
  return s.doc;
}

/** Gaps each side the fit coupon tries, mm, one slot each from the left (#182). */
export const FIT_CALIBRATION_GAPS = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4] as const;
/** The coupon's square peg, mm across. */
export const FIT_PEG = 10;

/**
 * The fit calibration coupon (#182): a plate with six square slots, each wider than the 10 mm peg by a gap each side
 * from 0.05 to 0.4 mm, and the peg beside it. The notches on the front edge count the slot: one notch is 0.05 mm, six is
 * 0.4 mm. Print both flat, try the peg in each slot, and tell the Print panel which it pressed into and which it slid in.
 */
function fitCalibration(): ModelDoc {
  const s = new Sample("Fit calibration");
  s.param("pitch", "16", "Between slot centres");
  s.param("thickness", "4", "Plate thickness, and how deep the peg goes in");
  s.param("edge", "4", "Plate edge past the outer slots");
  const n = FIT_CALIBRATION_GAPS.length;
  const width = `${n - 1} * pitch + ${FIT_PEG} + 2 * edge`;
  const depth = `${FIT_PEG} + 2 * edge + 4`;
  s.part("plate", "Plate", "box", { x: width, y: depth, z: "thickness" });
  const tools: { id: string; op: "cut" }[] = [];
  const col = (i: number) => `(${i} - ${(n - 1) / 2}) * pitch`;
  FIT_CALIBRATION_GAPS.forEach((g, i) => {
    const id = `slot${i}`;
    const w = `${FIT_PEG} + ${2 * g}`;
    s.part(id, `Slot ${g} mm`, "box", { x: w, y: w, z: "thickness + 2" }, { x: col(i), y: "2", z: "-1" });
    s.hole(id);
    tools.push({ id, op: "cut" });
    for (let k = 0; k <= i; k++) {
      const nid = `notch${i}_${k}`;
      s.part(
        nid,
        `Notch ${i + 1}.${k + 1}`,
        "box",
        { x: "1", y: "3", z: "thickness + 2" },
        { x: `${col(i)} + ${(k - i / 2) * 2}`, y: `-(${depth}) / 2`, z: "-1" },
      );
      s.hole(nid);
      tools.push({ id: nid, op: "cut" });
    }
  });
  s.group("Slot plate", "plate", tools);
  // The peg prints standing up beside the plate, a little taller than the plate so it's easy to hold.
  s.part("peg", "Peg", "box", { x: `${FIT_PEG}`, y: `${FIT_PEG}`, z: "thickness + 8" }, { y: `(${depth}) / 2 + ${FIT_PEG} / 2 + 6` });
  return s.doc;
}

export const SAMPLES: readonly SampleInfo[] = [
  { id: "box-with-lid", name: "Box with a lid", blurb: "A box with a lid that fits", build: boxWithLid },
  { id: "bracket", name: "Bracket", blurb: "An L bracket with M4 screw holes", build: bracket },
  { id: "phone-stand", name: "Phone stand", blurb: "Prints flat with no supports", build: phoneStand },
  { id: "hole-calibration", name: "Hole calibration", blurb: "Find the hole offset your printer needs", build: holeCalibration, card: false },
  { id: "fit-calibration", name: "Fit calibration", blurb: "Find the gaps your printer needs for parts that fit", build: fitCalibration, card: false },
];
