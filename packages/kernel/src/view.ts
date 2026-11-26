/**
 * What a flat view of a model is made of (#555): its curves, where each came from, and the sums on them. No
 * OpenCascade here, so the app's drawing code can use it; `occt/project.ts` makes the views.
 *
 * Millimetres on the view plane: x to the right, y up, the eye looking down the view's own z.
 */
export type V2 = [number, number];
export type V3 = [number, number, number];

/** Where the eye is and which way is up on the sheet. */
export interface ViewFrame {
  /** From the model towards the eye. Front is [0, -1, 0]: Z is up, so the front of a model faces -Y. */
  toEye: V3;
  /** What points up the sheet. */
  up: V3;
}

/** The six standard views and an isometric, for a model with Z up and its front facing -Y. */
export const VIEWS = {
  front: { toEye: [0, -1, 0], up: [0, 0, 1] },
  back: { toEye: [0, 1, 0], up: [0, 0, 1] },
  left: { toEye: [-1, 0, 0], up: [0, 0, 1] },
  right: { toEye: [1, 0, 0], up: [0, 0, 1] },
  top: { toEye: [0, 0, 1], up: [0, 1, 0] },
  bottom: { toEye: [0, 0, -1], up: [0, -1, 0] },
  iso: { toEye: [1, -1, 1], up: [0, 0, 1] },
} as const satisfies Record<string, ViewFrame>;

/** A flat curve. Angles are in radians, anticlockwise from +x; an arc runs anticlockwise from `from` to `to`. */
export type ViewCurve =
  | { kind: "line"; a: V2; b: V2 }
  | { kind: "circle"; c: V2; r: number }
  | { kind: "arc"; c: V2; r: number; from: number; to: number }
  /** `turn` is the angle of the long axis; `from` and `to` are the ellipse's own parameter, missing for a whole one. */
  | { kind: "ellipse"; c: V2; rx: number; ry: number; turn: number; from?: number; to?: number }
  /** Anything else (a spline, the outline of a torus), traced finely. */
  | { kind: "poly"; pts: V2[] };

/** `sharp`: a corner between two faces. `smooth`: a tangent edge, where a fillet meets a flat. `outline`: the limb of a round face. */
export type ViewEdgeType = "sharp" | "smooth" | "outline";

export interface ViewEdge {
  curve: ViewCurve;
  visible: boolean;
  type: ViewEdgeType;
  /** Which of the shapes given it came from, and its edge (or, for an outline, its face) in `elements` order. */
  from?: { body: number; edge?: number; face?: number };
}

/**
 * A round face (a hole, a pin, a fillet) as a drawing needs it: where its centre mark goes when seen end on, or its
 * centre line when seen from the side. Faces seen at a slant have neither and are left out.
 */
export type ViewRound = {
  /** Which of the shapes given, and its face in `elements` order. */
  body: number;
  face: number;
  r: number;
  /** A hole (the face looks in at its axis) rather than a pin or boss. */
  hole: boolean;
  /** How far round the face goes, radians: 2π for a whole hole, about π/2 for a fillet. */
  sweep: number;
} & ({ seen: "end"; c: V2 } | { seen: "side"; a: V2; b: V2 });

/**
 * A flat cut through the model, for a section view (#571): everything on the side `normal` points to is taken away.
 * A section view looks back along `normal`, at the cut face.
 */
export interface ViewCut {
  origin: V3;
  normal: V3;
  /**
   * The way the cutting line runs: a unit vector in the cut's plane, square to the way its parent view looks. Needed
   * by `half` and `steps`, which say where along the line the cut changes.
   */
  along?: V3;
  /** A half section: only what is past `origin` along `along` is taken away, so half the view is cut and half whole. */
  half?: boolean;
  /**
   * A stepped (offset) section: past each `at` along `along`, in millimetres from `origin`, the cut is moved `offset`
   * along `normal` from where `origin` has it. In order of `at`. Left out, the cut is one flat plane.
   */
  steps?: { at: number; offset: number }[];
}

export interface ProjectOptions {
  /** Cut the shapes before drawing them. */
  cut?: ViewCut;
  /** Work out hidden edges too. On by default. */
  hidden?: boolean;
  /** Keep tangent edges. On by default. */
  smooth?: boolean;
  /** Trace each curve back to the model. On by default; off is quicker, for a preview. */
  trace?: boolean;
}

export interface ProjectedView {
  edges: ViewEdge[];
  /** The view's box on the view plane. */
  box: { min: V2; max: V2 };
  /** Round faces seen end on or from the side, for centre marks and centre lines. Empty when tracing is off. */
  rounds: ViewRound[];
  /** With a cut: the outline of each shape's cut face, as loose pieces (each a run of points) on the view plane. */
  cuts?: { body: number; outline: V2[][] }[];
  /** Time spent, in ms: OpenCascade's hidden-line pass, reading the curves out, and tracing them back. */
  ms: { hide: number; read: number; trace: number };
}

export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  // Adding 0 turns -0 into 0.
  return [a[0] / l + 0, a[1] / l + 0, a[2] / l + 0];
};
export const TAU = Math.PI * 2;
export const turn = (a: number) => ((a % TAU) + TAU) % TAU;

/** The view's axes in the world: x to the right on the sheet, y up it, z towards the eye. */
export function viewAxes(frame: ViewFrame): { x: V3; y: V3; z: V3 } {
  const z = unit(frame.toEye);
  const x = unit(cross(frame.up, z));
  return { x, y: unit(cross(z, x)), z };
}

/** Points along a curve at fractions of its length (near enough), for tracing and tests: by default its middle and near its quarters. */
export function pointsOn(curve: ViewCurve, fr: number[] = [0.5, 0.23, 0.77]): V2[] {
  switch (curve.kind) {
    case "line":
      return fr.map((f) => [curve.a[0] + (curve.b[0] - curve.a[0]) * f, curve.a[1] + (curve.b[1] - curve.a[1]) * f]);
    case "circle":
      return fr.map((f) => [curve.c[0] + curve.r * Math.cos(f * TAU), curve.c[1] + curve.r * Math.sin(f * TAU)]);
    case "arc": {
      const sweep = turn(curve.to - curve.from) || TAU;
      return fr.map((f) => [curve.c[0] + curve.r * Math.cos(curve.from + sweep * f), curve.c[1] + curve.r * Math.sin(curve.from + sweep * f)]);
    }
    case "ellipse": {
      const from = curve.from ?? 0;
      const sweep = curve.from === undefined ? TAU : turn(curve.to! - curve.from) || TAU;
      const [cs, sn] = [Math.cos(curve.turn), Math.sin(curve.turn)];
      return fr.map((f) => {
        const [u, v] = [curve.rx * Math.cos(from + sweep * f), curve.ry * Math.sin(from + sweep * f)];
        return [curve.c[0] + u * cs - v * sn, curve.c[1] + u * sn + v * cs];
      });
    }
    case "poly":
      return fr.map((f) => curve.pts[Math.min(curve.pts.length - 1, Math.round((curve.pts.length - 1) * f))]!);
  }
}

/** A point's place round an ellipse or circle, as the curve's own parameter. */
export function paramAt(curve: Extract<ViewCurve, { kind: "circle" | "arc" | "ellipse" }>, p: V2): number {
  if (curve.kind !== "ellipse") return turn(Math.atan2(p[1] - curve.c[1], p[0] - curve.c[0]));
  const [cs, sn] = [Math.cos(curve.turn), Math.sin(curve.turn)];
  const [dx, dy] = [p[0] - curve.c[0], p[1] - curve.c[1]];
  return turn(Math.atan2((-dx * sn + dy * cs) / curve.ry, (dx * cs + dy * sn) / curve.rx));
}

/** How far a point is from a curve, mm. Near enough for telling whether it lies on it. */
export function distanceTo(curve: ViewCurve, p: V2): number {
  const toSeg = (a: V2, b: V2) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
  };
  switch (curve.kind) {
    case "line":
      return toSeg(curve.a, curve.b);
    case "poly": {
      let best = Infinity;
      for (let i = 1; i < curve.pts.length; i++) best = Math.min(best, toSeg(curve.pts[i - 1]!, curve.pts[i]!));
      return best;
    }
    case "circle":
      return Math.abs(Math.hypot(p[0] - curve.c[0], p[1] - curve.c[1]) - curve.r);
    default: {
      const t = paramAt(curve, p);
      const whole = curve.from === undefined;
      const sweep = whole ? TAU : turn(curve.to! - curve.from!) || TAU;
      const inside = whole || turn(t - curve.from!) <= sweep + 1e-9;
      const on = (u: number): V2 => {
        if (curve.kind === "arc") return [curve.c[0] + curve.r * Math.cos(u), curve.c[1] + curve.r * Math.sin(u)];
        const [cs, sn] = [Math.cos(curve.turn), Math.sin(curve.turn)];
        const [x, y] = [curve.rx * Math.cos(u), curve.ry * Math.sin(u)];
        return [curve.c[0] + x * cs - y * sn, curve.c[1] + x * sn + y * cs];
      };
      const d = (q: V2) => Math.hypot(q[0] - p[0], q[1] - p[1]);
      return inside ? d(on(t)) : Math.min(d(on(curve.from!)), d(on(curve.to!)));
    }
  }
}

/** The ends of an open curve. */
export function endsOf(curve: ViewCurve): V2[] {
  if (curve.kind === "line") return [curve.a, curve.b];
  if (curve.kind === "poly") return [curve.pts[0]!, curve.pts.at(-1)!];
  return [];
}

/** A curve's box, a little generous for round ones. */
export function boxOf(curve: ViewCurve): { min: V2; max: V2 } {
  const pts: V2[] =
    curve.kind === "line"
      ? [curve.a, curve.b]
      : curve.kind === "poly"
        ? curve.pts
        : ((r) => [[curve.c[0] - r, curve.c[1] - r] as V2, [curve.c[0] + r, curve.c[1] + r] as V2])(curve.kind === "ellipse" ? curve.rx : curve.r);
  const out = { min: [Infinity, Infinity] as V2, max: [-Infinity, -Infinity] as V2 };
  for (const p of pts) {
    out.min = [Math.min(out.min[0], p[0]), Math.min(out.min[1], p[1])];
    out.max = [Math.max(out.max[0], p[0]), Math.max(out.max[1], p[1])];
  }
  return out;
}

/** Where a curve of a model's view came from: a body's edge or face, by number and, where the body has them, by name (#47). */
export interface ViewSource {
  body: string;
  kind: "edge" | "face";
  index: number;
  name?: string;
}

/** A view of a model (#558), as the kernel worker hands it to the app: `projectView`'s result with bodies by id. */
export interface ModelView {
  edges: { curve: ViewCurve; visible: boolean; type: ViewEdgeType; source?: ViewSource }[];
  box: { min: V2; max: V2 };
  /** Round faces seen end on or from the side, for centre marks and centre lines. */
  rounds: (Omit<ViewRound, "body" | "face"> & { source: ViewSource })[];
  /** A section view's cut faces, for hatching: each body's outline as loose pieces on the view plane. */
  cuts?: { body: string; outline: V2[][] }[];
  /** The bodies drawn, in the order given. */
  bodies: string[];
  /** Time taken, ms; 0 when it came from the cache. */
  ms: number;
}

/** What to draw and how, for `ModelView`. */
export interface ModelViewRequest extends ProjectOptions {
  /**
   * The whole model, one component with everything in it, or picked bodies. Hidden bodies and holes stay out.
   * `asMade` draws picked bodies as they were made, before a track wrapped them round its wheels or a pose moved them:
   * a track's first link drawn flat for printing, not tipped where it sits on the track. `sketch` draws one sketch's
   * curves instead of any body (`sketchView.ts`).
   */
  shows: { all: true } | { component: string } | { bodies: string[]; asMade?: true } | { sketch: string };
  frame: ViewFrame;
  /**
   * An exploded view (#574): each component's bodies (each body, when no two are in different components) moved away
   * from the middle of what is shown by this many times how far its own middle is from it. 0.5 puts half as much
   * again between the parts. Left out or 0, everything is where the model has it.
   */
  explode?: number;
}
