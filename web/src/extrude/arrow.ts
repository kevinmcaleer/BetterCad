import { BufferGeometry, ConeGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from "three";
import { toWorld, type Frame, type Profile } from "@bettercad/sketch";
import {
  profilesMiddle,
  throughAllAllowed,
  toPartLocal,
  upToDistance,
  type ExtrudeFeature,
  type ExtrudeParams,
  type ExtrudeUpTo,
  type Part,
} from "../state/document";
import type { Engine, ScreenPoint } from "../viewport/engine";
import type { Pick } from "../viewport/ids";
import { readPalette } from "../viewport/colours";

type V3 = [number, number, number];

/** How long the head is and how wide, in screen pixels, and how near the pointer must come to grab it. */
const HEAD = 22;
const RADIUS = 7;
const REACH = 16;

/**
 * Extrude's direction arrow, Fusion style: a line from the middle of the picked shapes to where the extrude ends, and a
 * head there pointing the way it goes. Drawn over the bodies so it shows inside them. Drag the head to change the
 * distance; click it to flip the side.
 */
export class ExtrudeArrow {
  readonly group = new Group();
  private lineMat = new LineBasicMaterial({ depthTest: false, transparent: true });
  private headMat = new MeshBasicMaterial({ depthTest: false, transparent: true, opacity: 0.9 });
  private line = new Line(new BufferGeometry(), this.lineMat);
  private head = new Mesh(new ConeGeometry(1, 1, 20), this.headMat);
  private end: V3 = [0, 0, 0];
  private dir: V3 = [0, 0, 1];
  private hot = false;

  constructor(private eng: Engine) {
    this.line.renderOrder = 21;
    this.head.renderOrder = 21;
    this.line.frustumCulled = false;
    this.group.add(this.line, this.head);
    this.paint();
    eng.addOverlay(this.group);
  }

  /** From `base` along the unit `dir` to `end`; the head sits at `end`, pointing along `dir`. */
  update(base: V3, end: V3, dir: V3): void {
    this.end = end;
    this.dir = dir;
    this.line.geometry.setAttribute("position", new Float32BufferAttribute([...base, ...end], 3));
    this.line.geometry.computeBoundingSphere();
    const px = this.eng.pixelSize(end);
    const len = HEAD * px;
    const d = new Vector3(...dir).normalize();
    // The cone is built round Y, centred: lift it so its base sits on the end and its point goes on past.
    this.head.scale.set(RADIUS * px, len, RADIUS * px);
    this.head.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d));
    this.head.position.copy(new Vector3(...end).addScaledVector(d, len / 2));
    this.group.visible = true;
    this.eng.invalidate();
  }

  hide(): void {
    this.group.visible = false;
    this.eng.invalidate();
  }

  /** Whether the pointer is on the head, or near the line just behind it. */
  hit(p: ScreenPoint): boolean {
    if (!this.group.visible) return false;
    const len = HEAD * this.eng.pixelSize(this.end);
    const tip = this.eng.project([this.end[0] + this.dir[0] * len, this.end[1] + this.dir[1] * len, this.end[2] + this.dir[2] * len]);
    const back = this.eng.project(this.end);
    return segmentDistance(p, back, tip) <= REACH;
  }

  /** Lights the arrow while the pointer is on it. */
  setHot(on: boolean): void {
    if (on === this.hot) return;
    this.hot = on;
    this.paint();
    this.eng.invalidate();
  }

  /**
   * How many mm along the unit `axis` the pointer has moved from `from` to `to` on screen, measured where the arrow
   * ends, so the head follows the pointer.
   */
  along(from: ScreenPoint, to: ScreenPoint, axis: V3): number {
    const a = this.eng.project(this.end);
    const b = this.eng.project([this.end[0] + axis[0], this.end[1] + axis[1], this.end[2] + axis[2]]);
    const [sx, sy] = [b.x - a.x, b.y - a.y];
    const l2 = sx * sx + sy * sy;
    if (l2 < 1e-6) return 0;
    return ((to.x - from.x) * sx + (to.y - from.y) * sy) / l2;
  }

  /** The current theme's colours: snap blue, accent while hot. */
  paint(): void {
    const p = readPalette();
    const c = this.hot ? p.accent : p.snap;
    this.lineMat.color.copy(c);
    this.headMat.color.copy(c);
  }

  dispose(): void {
    this.eng.removeOverlay(this.group);
    this.line.geometry.dispose();
    this.head.geometry.dispose();
    this.lineMat.dispose();
    this.headMat.dispose();
  }
}

/** Distance from a point to a segment, in screen pixels. */
export function segmentDistance(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const l2 = dx * dx + dy * dy;
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/**
 * Where Extrude's arrow goes: from the middle of the picked shapes on the sketch's plane to the end the drag moves,
 * pointing the way it goes. `length` is that end along the sketch's normal, signed; through all has no end, so its
 * arrow is `reach` long on its side.
 */
export function arrowOf(
  f: ExtrudeFeature,
  frame: Frame,
  picked: Profile[],
  reachAt: number | ((base: V3) => number),
): { base: V3; end: V3; dir: V3; length: number } {
  const base = toWorld(frame, profilesMiddle(picked)) as V3;
  const reach = typeof reachAt === "number" ? reachAt : reachAt(base);
  const n = frame.normal;
  const all = f.extent === "all" && throughAllAllowed(f.operation);
  const one = f.direction === "one" || f.extent === "to";
  let length: number;
  if (all) length = one && f.distance < 0 ? -reach : reach;
  else if (one) length = f.distance;
  else if (f.direction === "symmetric") length = Math.abs(f.distance) / 2;
  else length = Math.abs(f.distance);
  const s = length < 0 ? -1 : 1;
  return {
    base,
    end: [base[0] + n[0] * length, base[1] + n[1] * length, base[2] + n[2] * length],
    dir: [n[0] * s, n[1] * s, n[2] * s],
    length,
  };
}

/** The settings a drag of the arrow to `length` (signed, along the normal) makes. Null when it would be 0 mm. */
export function dragTo(f: ExtrudeFeature, length: number): Partial<ExtrudeParams> | null {
  const r = Math.round(length * 10) / 10;
  const one = f.direction === "one" || f.extent === "to" || f.extent === "all";
  // Through all and To object have no distance of their own: dragging gives them one.
  const extent = f.extent && f.extent !== "distance" ? { extent: "distance" as const } : {};
  if (one) return Math.abs(r) < 0.1 ? null : { ...extent, ...(f.extent === "to" ? { direction: "one" as const } : {}), distance: r };
  if (r < 0.1) return null;
  return { ...extent, distance: f.direction === "symmetric" ? Math.round(r * 20) / 10 : r };
}

/** What a click on the arrow does: one side goes to the other side, two sides swap. Null when it has no other way. */
export function flipOf(f: ExtrudeFeature): Partial<ExtrudeParams> | null {
  if (f.extent === "to") return null;
  if (f.direction === "symmetric") return null;
  if (f.direction === "two") return { distance: f.distance2 || 1, distance2: Math.abs(f.distance) };
  return { distance: -(f.distance || 1) };
}

/**
 * Where To object ends for a picked face, edge or corner: a flat face's plane, else one point (the corner, the edge's
 * middle, or the point clicked on a curved face), kept in its body's own coordinates so it follows the body. A string
 * says why it can't end there.
 */
export function upToOf(
  eng: Engine,
  hit: Pick,
  p: ScreenPoint,
  part: Part,
  frame: Frame,
  picked: Profile[],
): { to: ExtrudeUpTo; reach: number } | string | null {
  let at: { point: V3; normal?: V3 } | null = null;
  if (hit.kind === "face") {
    const info = eng.faceInfo(hit.body, hit.index);
    if (info) at = info.flat ? { point: info.centroid, normal: info.normal } : { point: eng.surfaceAt(p.x, p.y)?.point ?? info.centroid };
  } else if (hit.kind === "edge" || hit.kind === "vertex") {
    // An edge stops level with its middle, a corner with itself.
    const pts = hit.kind === "edge" ? eng.edgePoints(hit.body, hit.index) : [eng.vertexPoint(hit.body, hit.index)].filter((q): q is V3 => !!q);
    if (pts?.length) at = { point: [0, 1, 2].map((i) => pts.reduce((a, q) => a + q[i]!, 0) / pts.length) as V3 };
  }
  if (!at) return null;
  const reach = upToDistance(frame, profilesMiddle(picked), at);
  if (typeof reach === "string") return reach;
  return {
    reach,
    to: {
      body: hit.body,
      kind: hit.kind === "face" ? "face" : hit.kind === "edge" ? "edge" : "vertex",
      point: toPartLocal(at.point, part),
      ...(at.normal ? { normal: toPartLocal(at.normal, part, true) } : {}),
    },
  };
}
