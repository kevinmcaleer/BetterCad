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
      uniform float dpr;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * dpr;
      }`,
    fragmentShader: `
      uniform vec3 fill;
      uniform vec3 ring;
      void main() {
        float r = length(gl_PointCoord * 2.0 - 1.0);
        if (r > 1.0) discard;
        gl_FragColor = vec4(r > 0.62 ? ring : fill, 1.0);
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
  private added = false;

  constructor(private eng: Engine) {
    const p = readPalette();
    this.dots = new Points(new BufferGeometry(), dotMaterial(p["snap-point"], p["snap-point-ring"], eng.renderer.getPixelRatio()));
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 8;
    this.axes = new LineSegments2(new LineSegmentsGeometry(), this.axisMat);
    this.axes.frustumCulled = false;
    this.axes.renderOrder = 7;
    this.group.add(this.axes, this.dots);
  }

  /** Shows `points`, with `hot` (an index, or -1) bigger and with its axes. Nothing to show hides them. */
  show(points: SnapPoint[], hot: number): void {
    if (!points.length) return this.hide();
    const pos = new Float32Array(points.length * 3);
    const size = new Float32Array(points.length);
    points.forEach((s, i) => {
      pos.set(s.point, i * 3);
      size[i] = i === hot ? DOT_HOT : DOT;
    });
    this.dots.geometry.dispose();
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("size", new BufferAttribute(size, 1));
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
    if (!this.added) {
      this.eng.addOverlay(this.group);
      this.added = true;
    } else this.eng.invalidate();
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
    this.axes.geometry.dispose();
    this.axisMat.dispose();
  }
}
