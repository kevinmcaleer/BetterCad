import { Group } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { FoundHole, V3 } from "@bettercad/kernel/recognise";
import type { Engine } from "../viewport/engine";
import { readPalette } from "../viewport/colours";

const SIDES = 48;

/** The segments of a circle round `centre`, square to `normal`. */
export function circle(centre: V3, normal: V3, radius: number): number[] {
  const far = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = [normal[1] * far[2]! - normal[2] * far[1]!, normal[2] * far[0]! - normal[0] * far[2]!, normal[0] * far[1]! - normal[1] * far[0]!];
  const ul = Math.hypot(u[0]!, u[1]!, u[2]!) || 1;
  const x = u.map((c) => c / ul);
  const y = [normal[1] * x[2]! - normal[2] * x[1]!, normal[2] * x[0]! - normal[0] * x[2]!, normal[0] * x[1]! - normal[1] * x[0]!];
  const at = (i: number) => {
    const a = (i / SIDES) * Math.PI * 2;
    return [0, 1, 2].map((k) => centre[k]! + radius * (Math.cos(a) * x[k]! + Math.sin(a) * y[k]!));
  };
  const out: number[] = [];
  for (let i = 0; i < SIDES; i++) out.push(...at(i), ...at(i + 1));
  return out;
}

/**
 * The found holes' rims in the view (#446), drawn over the model: the ones that will become Hole steps in the picked
 * colour, the rest muted, and the one pointed at brighter.
 */
export class HoleMarks {
  private group = new Group();
  private lines: LineSegments2[] = [];
  private mats: LineMaterial[] = [];
  private added = false;

  constructor(private eng: Engine) {
    const widths = [2, 3, 4];
    for (let i = 0; i < 3; i++) {
      const m = new LineMaterial({ linewidth: widths[i]!, depthTest: false, transparent: true, worldUnits: false });
      const l = new LineSegments2(new LineSegmentsGeometry(), m);
      l.frustumCulled = false;
      l.renderOrder = 6 + i;
      this.mats.push(m);
      this.lines.push(l);
      this.group.add(l);
    }
  }

  /** `on[i]`: hole i will become a step. `hot`: the holes pointed at. */
  show(holes: FoundHole[], on: boolean[], hot: number[]): void {
    const p = readPalette();
    this.mats[0]!.color.copy(p.muted);
    this.mats[1]!.color.copy(p.picked);
    this.mats[2]!.color.copy(p.accent);
    const sets: number[][] = [[], [], []];
    holes.forEach((h, i) => {
      const r = (h.head?.diameter ?? h.diameter) / 2;
      sets[hot.includes(i) ? 2 : on[i] ? 1 : 0]!.push(...circle(h.origin, h.normal, r));
    });
    this.lines.forEach((l, i) => {
      l.visible = sets[i]!.length > 0;
      l.geometry.dispose();
      l.geometry = new LineSegmentsGeometry();
      if (sets[i]!.length) l.geometry.setPositions(sets[i]!);
    });
    if (!this.added) {
      this.eng.addOverlay(this.group);
      this.added = true;
    } else this.eng.invalidate();
  }

  dispose(): void {
    if (this.added) this.eng.removeOverlay(this.group);
    this.added = false;
    for (const l of this.lines) l.geometry.dispose();
    for (const m of this.mats) m.dispose();
  }
}
