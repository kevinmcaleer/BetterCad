import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  ShapeUtils,
  Vector2,
  Vector3,
} from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { frameY, type Frame, type Vec2 } from "@bettercad/sketch";
import type { Engine } from "../viewport/engine";
import { readPalette, type Palette } from "../viewport/colours";

/**
 * The active sketch drawn over the model (#51), on its plane and through everything (no depth test): curves as
 * screen-width lines (1.5 px, 2.5 px when picked), construction dashed, points as 5 px squares, each in its state's
 * colour: snap blue while free, ink when fully constrained, accent when picked or hovered, danger in a conflict.
 */
export type Shade = "free" | "fixed" | "picked" | "hover" | "conflict" | "preview" | "guide";

export interface OverlayCurve {
  pts: Vec2[];
  shade: Shade;
  dashed?: boolean;
}
export interface OverlayPoint {
  xy: Vec2;
  shade: Shade;
  big?: boolean;
}
/** A shaded region: a closed shape Extrude can pick (#61), with its holes. */
export interface OverlayFill {
  outer: Vec2[];
  holes: Vec2[][];
  shade: Shade;
}
/** The sketch grid on the sketch's plane: minor and major lines, in sketch mm. */
export interface OverlayGrid {
  minor: Vec2[][];
  major: Vec2[][];
}
export interface OverlayView {
  frame: Frame;
  curves: OverlayCurve[];
  points: OverlayPoint[];
  fills?: OverlayFill[];
  /** How strong the fills are: 0.35 for Extrude's pickable shapes, fainter for the profiles shown while sketching. */
  fillOpacity?: number;
  grid?: OverlayGrid | null;
}

const ORDER = 20;

export class SketchOverlay {
  readonly group = new Group();
  private thin = new LineMaterial({ linewidth: 1.5, vertexColors: true, worldUnits: false });
  private bold = new LineMaterial({ linewidth: 2.5, vertexColors: true, worldUnits: false });
  private dashed = new LineMaterial({ linewidth: 1.5, vertexColors: true, worldUnits: false, dashed: true });
  private lines = [this.thin, this.bold, this.dashed].map((m) => {
    m.depthTest = false;
    m.transparent = true;
    const l = new LineSegments2(new LineSegmentsGeometry(), m);
    l.renderOrder = ORDER;
    l.frustumCulled = false;
    this.group.add(l);
    return l;
  });
  private pointMat = new PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true });
  private bigMat = new PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true });
  private points = [this.pointMat, this.bigMat].map((m) => {
    const p = new Points(new BufferGeometry(), m);
    p.renderOrder = ORDER + 1;
    p.frustumCulled = false;
    this.group.add(p);
    return p;
  });
  private fillMat = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false, side: DoubleSide });
  private fill = (() => {
    const m = new Mesh(new BufferGeometry(), this.fillMat);
    m.renderOrder = ORDER - 1;
    m.frustumCulled = false;
    this.group.add(m);
    return m;
  })();
  /** The sketch grid, under everything else in the sketch, one pixel wide and faint. */
  private gridMat = new LineMaterial({ linewidth: 1, vertexColors: true, worldUnits: false, transparent: true, opacity: 0.6 });
  private gridLines = (() => {
    this.gridMat.depthTest = false;
    const l = new LineSegments2(new LineSegmentsGeometry(), this.gridMat);
    l.renderOrder = ORDER - 2;
    l.frustumCulled = false;
    l.visible = false;
    this.group.add(l);
    return l;
  })();
  private palette: Palette = readPalette();

  constructor(private engine: Engine) {
    this.group.matrixAutoUpdate = false;
    engine.addOverlay(this.group);
  }

  /** Re-reads the theme's colours (after a theme change). */
  refreshPalette(): void {
    this.palette = readPalette();
  }

  private colour(s: Shade): Color {
    const p = this.palette;
    return s === "fixed" ? p.ink : s === "picked" || s === "hover" ? p.accent : s === "conflict" ? p.danger : s === "guide" ? p.muted : p.snap;
  }

  update(v: OverlayView): void {
    const f = v.frame;
    const y = frameY(f);
    const m = new Matrix4().makeBasis(new Vector3(...f.x), new Vector3(...y), new Vector3(...f.normal));
    m.setPosition(...f.origin);
    this.group.matrix.copy(m);
    this.group.matrixWorldNeedsUpdate = true;

    const buckets: { pos: number[]; col: number[] }[] = [0, 1, 2].map(() => ({ pos: [], col: [] }));
    for (const c of v.curves) {
      const b = buckets[c.dashed ? 2 : c.shade === "picked" || c.shade === "conflict" ? 1 : 0]!;
      const col = this.colour(c.shade);
      for (let i = 0; i + 1 < c.pts.length; i++) {
        const [a, e] = [c.pts[i]!, c.pts[i + 1]!];
        b.pos.push(a[0], a[1], 0, e[0], e[1], 0);
        b.col.push(col.r, col.g, col.b, col.r, col.g, col.b);
      }
    }
    // Dashes about 4 px on screen at the sketch's origin.
    const px = this.engine.pixelSize(f.origin as [number, number, number]);
    this.dashed.dashSize = 4 * px;
    this.dashed.gapSize = 4 * px;
    this.lines.forEach((l, i) => {
      const b = buckets[i]!;
      const g = new LineSegmentsGeometry();
      if (b.pos.length) {
        g.setPositions(b.pos);
        g.setColors(b.col);
      }
      l.geometry.dispose();
      l.geometry = g;
      l.visible = b.pos.length > 0;
      if (i === 2 && b.pos.length) l.computeLineDistances();
    });

    [false, true].forEach((big, i) => {
      const pts = v.points.filter((p) => !!p.big === big);
      const pos = new Float32Array(pts.length * 3);
      const col = new Float32Array(pts.length * 3);
      pts.forEach((p, k) => {
        pos.set([p.xy[0], p.xy[1], 0], k * 3);
        const c = this.colour(p.shade);
        col.set([c.r, c.g, c.b], k * 3);
      });
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(pos, 3));
      g.setAttribute("color", new BufferAttribute(col, 3));
      this.points[i]!.geometry.dispose();
      this.points[i]!.geometry = g;
    });
    this.drawGrid(v.grid ?? null);
    this.fillMat.opacity = v.fillOpacity ?? 0.35;
    const pos: number[] = [];
    const col: number[] = [];
    for (const f of v.fills ?? []) {
      const ring = [f.outer, ...f.holes].flat();
      const tris = ShapeUtils.triangulateShape(
        f.outer.map((p) => new Vector2(p[0], p[1])),
        f.holes.map((h) => h.map((p) => new Vector2(p[0], p[1]))),
      );
      const c = this.colour(f.shade);
      for (const t of tris)
        for (const i of t) {
          const p = ring[i]!;
          pos.push(p[0], p[1], 0);
          col.push(c.r, c.g, c.b);
        }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
    this.fill.geometry.dispose();
    this.fill.geometry = g;
    this.fill.visible = pos.length > 0;
    this.engine.invalidate();
  }

  private drawGrid(grid: OverlayGrid | null): void {
    const g = new LineSegmentsGeometry();
    const pos: number[] = [];
    const col: number[] = [];
    if (grid) {
      for (const [lines, c] of [
        [grid.minor, this.palette.grid],
        [grid.major, this.palette["grid-major"]],
      ] as const) {
        for (const [a, b] of lines) {
          pos.push(a![0], a![1], 0, b![0], b![1], 0);
          col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
      }
    }
    if (pos.length) {
      g.setPositions(pos);
      g.setColors(col);
    }
    this.gridLines.geometry.dispose();
    this.gridLines.geometry = g;
    this.gridLines.visible = pos.length > 0;
  }

  dispose(): void {
    this.engine.removeOverlay(this.group);
    this.gridLines.geometry.dispose();
    this.gridMat.dispose();
    for (const l of this.lines) l.geometry.dispose();
    for (const p of this.points) p.geometry.dispose();
    this.fill.geometry.dispose();
    for (const m of [this.thin, this.bold, this.dashed, this.pointMat, this.bigMat, this.fillMat]) m.dispose();
  }
}
