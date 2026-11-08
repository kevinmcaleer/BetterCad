import type { TopoDS_Shape } from "replicad-opencascadejs";
import type { OC } from "./oc";
import { KernelError } from "../errors";
import type { Mat4 } from "../pose";

type V3 = [number, number, number];
interface Box {
  min: V3;
  max: V3;
}

/** A body for the clash check (#178): its solid, where it is posed, and the link it rides on. */
export interface ClashBody {
  id: string;
  shape: TopoDS_Shape;
  link?: string;
  move?: Mat4;
}

/** Two bodies that overlap (a volume, mm³) or only touch (volume 0), and where: the overlap's box and centre. */
export interface Clash {
  a: string;
  b: string;
  kind: "overlap" | "touch";
  volume: number;
  centre: V3;
  box: Box;
}

export interface ClashOptions {
  /** Check bodies in the same link against each other too (they move together, so they're usually meant to touch). */
  sameLink?: boolean;
  cancelled?: () => boolean;
  progress?: (fraction: number) => void;
}

/** Gaps closer than this count as touching, mm; overlaps smaller than this are touching too, mm³. */
const TOUCH_GAP = 1e-3;
const MIN_VOLUME = 1e-3;

const pnt = (p: { X(): number; Y(): number; Z(): number }): V3 => [p.X(), p.Y(), p.Z()];

function boxOf(oc: OC, s: TopoDS_Shape): Box {
  const b = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(s, b, false, false);
  const out = { min: pnt(b.CornerMin()), max: pnt(b.CornerMax()) };
  b.delete();
  return out;
}

const meet = (a: Box, b: Box, by: number) => a.min.every((v, i) => v <= b.max[i]! + by && b.min[i]! <= a.max[i]! + by);

/** A solid moved to its pose. */
export function moved(oc: OC, shape: TopoDS_Shape, m: Mat4 | undefined): TopoDS_Shape {
  if (!m) return shape;
  const t = new oc.gp_Trsf();
  t.SetValues(m[0]!, m[4]!, m[8]!, m[12]!, m[1]!, m[5]!, m[9]!, m[13]!, m[2]!, m[6]!, m[10]!, m[14]!);
  const out = new oc.BRepBuilderAPI_Transform(shape, t, true, false).Shape();
  t.delete();
  return out;
}

/** The solid two bodies share (#178), or null when it can't be worked out. */
export function overlapOf(oc: OC, a: TopoDS_Shape, b: TopoDS_Shape): TopoDS_Shape | null {
  const common = new oc.BRepAlgoAPI_Common(a, b, new oc.Message_ProgressRange());
  common.Build(new oc.Message_ProgressRange());
  const out = common.IsDone() ? common.Shape() : null;
  common.delete();
  return out;
}

/** Whether two posed bodies really share some volume (#179): the exact check the clash sweep ends its ranges with. */
export function overlapsAt(oc: OC, a: TopoDS_Shape, ma: Mat4 | undefined, b: TopoDS_Shape, mb: Mat4 | undefined): boolean {
  const shape = overlapOf(oc, moved(oc, a, ma), moved(oc, b, mb));
  if (!shape) return false;
  const props = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, props, false, false, false);
  const volume = props.Mass();
  props.delete();
  return volume > MIN_VOLUME;
}

/**
 * Pairs of bodies that overlap or touch (#178). Boxes first, then the exact common volume of each pair whose boxes
 * meet; a pair with none is touching when its gap is under a micron. Pairs in one link are skipped unless asked for.
 */
export function findClashes(oc: OC, bodies: ClashBody[], opts: ClashOptions = {}): Clash[] {
  const placed = bodies.map((b) => {
    const shape = moved(oc, b.shape, b.move);
    return { ...b, shape, box: boxOf(oc, shape) };
  });
  const pairs: [number, number][] = [];
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!;
      const b = placed[j]!;
      if (!opts.sameLink && a.link && a.link === b.link) continue;
      if (meet(a.box, b.box, TOUCH_GAP)) pairs.push([i, j]);
    }
  const out: Clash[] = [];
  pairs.forEach(([i, j], k) => {
    if (opts.cancelled?.()) throw new KernelError("cancelled", "Stopped.");
    opts.progress?.(k / pairs.length);
    const a = placed[i]!;
    const b = placed[j]!;
    const shape = overlapOf(oc, a.shape, b.shape);
    if (shape) {
      const props = new oc.GProp_GProps();
      oc.BRepGProp.VolumeProperties(shape, props, false, false, false);
      const volume = props.Mass();
      if (volume > MIN_VOLUME) {
        out.push({ a: a.id, b: b.id, kind: "overlap", volume, centre: pnt(props.CentreOfMass()), box: boxOf(oc, shape) });
        props.delete();
        return;
      }
      props.delete();
    }
    const ext = new oc.BRepExtrema_DistShapeShape(a.shape, b.shape);
    if (ext.IsDone() && ext.NbSolution() > 0 && ext.Value() <= TOUCH_GAP) {
      const p = pnt(ext.PointOnShape1(1));
      // Where they touch: the box shared by the two bodies, which is a face, an edge or a point.
      const min = a.box.min.map((v, n) => Math.max(v, b.box.min[n]!)) as V3;
      const max = a.box.max.map((v, n) => Math.min(v, b.box.max[n]!)) as V3;
      out.push({ a: a.id, b: b.id, kind: "touch", volume: 0, centre: p, box: { min, max } });
    }
    ext.delete();
  });
  opts.progress?.(1);
  // The biggest overlaps first, then the touches.
  return out.sort((x, y) => y.volume - x.volume);
}
