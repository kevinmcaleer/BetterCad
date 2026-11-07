import { BufferAttribute, BufferGeometry, Color, Group, Points, PointsMaterial } from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Pair } from "@bettercad/kernel";

type V3 = [number, number, number];
import type { Engine } from "../viewport/engine";
import { readPalette } from "../viewport/colours";

/**
 * A measurement drawn in the view (#71): a snap-blue line between the two closest points with dots at its ends, and
 * the X, Y and Z parts of it as dashed lines in the axis colours when components are shown. Drawn through the model.
 */
export class MeasureOverlay {
  private group = new Group();
  private solid = new LineMaterial({ linewidth: 2, vertexColors: true, worldUnits: false });
  private dashed = new LineMaterial({ linewidth: 1.5, vertexColors: true, worldUnits: false, dashed: true });
  private dots = new PointsMaterial({ size: 8, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true });

  constructor(private engine: Engine) {
    engine.addOverlay(this.group);
  }

  update(pair: Pair | undefined, components: boolean): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as { geometry?: BufferGeometry }).geometry?.dispose();
    }
    if (!pair) return this.engine.invalidate();
    const p = readPalette();
    const add = (mat: LineMaterial, segs: [V3, V3, Color][]) => {
      if (!segs.length) return;
      mat.depthTest = false;
      mat.transparent = true;
      const g = new LineSegmentsGeometry();
      g.setPositions(segs.flatMap(([a, b]) => [...a, ...b]));
      g.setColors(segs.flatMap(([, , c]) => [c.r, c.g, c.b, c.r, c.g, c.b]));
      const l = new LineSegments2(g, mat);
      l.renderOrder = 30;
      l.frustumCulled = false;
      if (mat.dashed) l.computeLineDistances();
      this.group.add(l);
    };
    const { from, to } = pair;
    add(this.solid, pair.distance > 1e-9 ? [[from, to, p.snap]] : []);
    if (components) {
      const px = this.engine.pixelSize(from);
      this.dashed.dashSize = 4 * px;
      this.dashed.gapSize = 4 * px;
      const x: V3 = [to[0], from[1], from[2]];
      const y: V3 = [to[0], to[1], from[2]];
      add(
        this.dashed,
        (
          [
            [from, x, p["axis-x"]],
            [x, y, p["axis-y"]],
            [y, to, p["axis-z"]],
          ] as [V3, V3, Color][]
        ).filter(([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1e-9),
      );
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array([...from, ...to]), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array([p.snap.r, p.snap.g, p.snap.b, p.snap.r, p.snap.g, p.snap.b]), 3));
    const dots = new Points(g, this.dots);
    dots.renderOrder = 31;
    dots.frustumCulled = false;
    this.group.add(dots);
    this.engine.invalidate();
  }

  dispose(): void {
    this.update(undefined, false);
    this.engine.removeOverlay(this.group);
    this.solid.dispose();
    this.dashed.dispose();
    this.dots.dispose();
  }
}
