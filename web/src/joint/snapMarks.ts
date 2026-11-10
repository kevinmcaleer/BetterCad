import { BufferAttribute, BufferGeometry, Group, Points, ShaderMaterial, type Color } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { Engine } from "../viewport/engine";
import { readPalette } from "../viewport/colours";
import type { SnapPoint, V3 } from "./snapPoints";

/** Diameter of a snap point's circle, and of the one under the pointer, in CSS px. */
export const DOT = 11;
export const DOT_HOT = 16;
/** Length of the hovered snap's axes, in CSS px. */
const AXIS_PX = 40;

/** Round dots a fixed size on screen: a fill with a ring, drawn over the model. */
function dotMaterial(fill: Color, ring: Color, dpr: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { fill: { value: fill }, ring: { value: ring }, dpr: { value: dpr } },
    vertexShader: `
      attribute float size;
      attribute float hollow;
      uniform float dpr;
      varying float vHollow;
      void main() {
        vHollow = hollow;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * dpr;
      }`,
    fragmentShader: `
      uniform vec3 fill;
      uniform vec3 ring;
      varying float vHollow;
      void main() {
        float r = length(gl_PointCoord * 2.0 - 1.0);
        if (r > 1.0) discard;
        // A cut-away corner (#389) is hollow: the ring's colour inside, the dot's round it.
        bool outer = r > 0.62;
        gl_FragColor = vec4((vHollow > 0.5 ? !outer : outer) ? ring : fill, 1.0);
        #include <colorspace_fragment>
      }`,
    depthTest: false,
    transparent: true,
  });
}

/**
 * The Joint tool's snap points in the view (#384): a small circle for each, and for the one under the pointer a bigger
 * circle with its axes (Z out of the face, the way the part will face), all drawn over the model.
 */
export class SnapMarks {
  private group = new Group();
  private dots: Points;
  private axes: LineSegments2;
  private axisMat = new LineMaterial({ linewidth: 2.5, vertexColors: true, depthTest: false, transparent: true, worldUnits: false });
  private ghosts: LineSegments2;
  private ghostMat = new LineMaterial({ linewidth: 1.5, depthTest: false, transparent: true, worldUnits: false });
  private added = false;
  /** The first of two Shift-clicks (#388), until the second. */
  private pinned: Points;

  constructor(private eng: Engine) {
    const p = readPalette();
    this.dots = new Points(new BufferGeometry(), dotMaterial(p["snap-point"], p["snap-point-ring"], eng.renderer.getPixelRatio()));
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 8;
    this.axes = new LineSegments2(new LineSegmentsGeometry(), this.axisMat);
    this.axes.frustumCulled = false;
    this.axes.renderOrder = 7;
    this.ghostMat.color.copy(p["snap-point"]);
    this.ghosts = new LineSegments2(new LineSegmentsGeometry(), this.ghostMat);
    this.ghosts.frustumCulled = false;
    this.ghosts.renderOrder = 7;
    this.pinned = new Points(new BufferGeometry(), dotMaterial(p.picked, p["snap-point-ring"], eng.renderer.getPixelRatio()));
    this.pinned.frustumCulled = false;
    this.pinned.renderOrder = 9;
    this.pinned.visible = false;
    this.group.add(this.ghosts, this.axes, this.dots, this.pinned);
  }

  /**
   * Shows `points`, with `hot` (an index, or -1) bigger and with its axes, and `ghosts` (edges a bevel cut away) as
   * dashed lines. Nothing to show hides them.
   */
  show(points: SnapPoint[], hot: number, ghosts: [V3, V3][] = []): void {
    if (!points.length) return this.hide();
    const pos = new Float32Array(points.length * 3);
    const size = new Float32Array(points.length);
    const hollow = new Float32Array(points.length);
    points.forEach((s, i) => {
      pos.set(s.point, i * 3);
      size[i] = i === hot ? DOT_HOT : DOT;
      hollow[i] = s.sharp ? 1 : 0;
    });
    this.dots.geometry.dispose();
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("size", new BufferAttribute(size, 1));
    g.setAttribute("hollow", new BufferAttribute(hollow, 1));
    this.dots.geometry = g;
    const h = points[hot];
    this.axes.visible = !!h;
    if (h) {
      const p = readPalette();
      const l = AXIS_PX * this.eng.pixelSize(h.point);
      const y: V3 = [h.normal[1] * h.x[2] - h.normal[2] * h.x[1], h.normal[2] * h.x[0] - h.normal[0] * h.x[2], h.normal[0] * h.x[1] - h.normal[1] * h.x[0]];
      const tip = (d: V3): V3 => [h.point[0] + d[0] * l, h.point[1] + d[1] * l, h.point[2] + d[2] * l];
      const lines = [h.point, tip(h.x), h.point, tip(y), h.point, tip(h.normal)].flat();
      const cols = [p["axis-x"], p["axis-x"], p["axis-y"], p["axis-y"], p["axis-z"], p["axis-z"]].flatMap((c) => [c.r, c.g, c.b]);
      this.axes.geometry.dispose();
      this.axes.geometry = new LineSegmentsGeometry().setPositions(lines).setColors(cols);
    }
    this.ghosts.visible = ghosts.length > 0;
    if (ghosts.length) {
      const dashes: number[] = [];
      for (const [a, b] of ghosts) {
        const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const l = Math.hypot(...d);
        const px = this.eng.pixelSize([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
        const on = 5 * px;
        const step = 9 * px;
        for (let t = 0; t < l; t += step) {
          const e = Math.min(l, t + on);
          dashes.push(...[0, 1, 2].map((k) => a[k]! + (d[k]! * t) / l), ...[0, 1, 2].map((k) => a[k]! + (d[k]! * e) / l));
        }
      }
      this.ghosts.geometry.dispose();
      this.ghosts.geometry = new LineSegmentsGeometry().setPositions(dashes);
    }
    if (!this.added) {
      this.eng.addOverlay(this.group);
      this.added = true;
    } else this.eng.invalidate();
  }

  /** Marks the first of two Shift-clicks, or clears it. */
  pin(at: V3 | null): void {
    this.pinned.visible = !!at;
    if (at) {
      this.pinned.geometry.dispose();
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(at), 3));
      g.setAttribute("size", new BufferAttribute(new Float32Array([DOT_HOT]), 1));
      g.setAttribute("hollow", new BufferAttribute(new Float32Array([0]), 1));
      this.pinned.geometry = g;
    }
    this.eng.invalidate();
  }

  hide(): void {
    if (!this.added) return;
    this.eng.removeOverlay(this.group);
    this.added = false;
  }

  dispose(): void {
    this.hide();
    this.dots.geometry.dispose();
    (this.dots.material as ShaderMaterial).dispose();
    this.pinned.geometry.dispose();
    (this.pinned.material as ShaderMaterial).dispose();
    this.axes.geometry.dispose();
    this.axisMat.dispose();
    this.ghosts.geometry.dispose();
    this.ghostMat.dispose();
  }
}
