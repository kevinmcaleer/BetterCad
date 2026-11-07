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

export const SAMPLES: readonly SampleInfo[] = [
  { id: "box-with-lid", name: "Box with a lid", blurb: "A box with a lid that fits", build: boxWithLid },
  { id: "bracket", name: "Bracket", blurb: "An L bracket with M4 screw holes", build: bracket },
  { id: "phone-stand", name: "Phone stand", blurb: "Prints flat with no supports", build: phoneStand },
];
