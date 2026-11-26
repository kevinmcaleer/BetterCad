/**
 * Camera moves for the Render view's animations: orbits and jib-style sweeps round the middle of the model.
 *
 * A move is plain data (which preset, how long, how it eases), so moves can later be put one after another to make a
 * film of the model. `cameraAt` turns a move and a moment into a camera, with no WebGL, so it can be tested.
 */
import { fit } from "../viewport/fitSphere";
import type { CameraState, V3 } from "../viewport/camera";

export type CameraMoveId = "orbit" | "ramp" | "rise" | "crane" | "push";
/** How a move gathers and loses speed: steady, slow at both ends, or slowing to a stop. */
export type Easing = "linear" | "inOut" | "ramp" | "out";

/** One camera move, as data. */
export interface CameraMove {
  preset: CameraMoveId;
  seconds: number;
  easing: Easing;
}

export interface MovePreset {
  id: CameraMoveId;
  label: string;
  title: string;
  easing: Easing;
  /** Degrees it turns round the model, left to right. */
  turn: number;
  /** Where in the turn your view sits: 0 the move starts from it, 0.5 it passes through it, 1 it ends on it. */
  anchor: number;
  /** Height in degrees above the floor, from and to, or null to keep your view's. */
  rise: [number, number] | null;
  /** Distance as a share of the distance that frames the whole model, from and to. */
  zoom: [number, number];
}

export const CAMERA_MOVES: MovePreset[] = [
  {
    id: "orbit",
    label: "Orbit",
    title: "Turns once round the model, left to right, at a steady speed",
    easing: "linear",
    turn: 360,
    anchor: 0,
    rise: null,
    zoom: [1, 1],
  },
  {
    id: "ramp",
    label: "Speed ramp orbit",
    title: "Turns once round the model, starting slow, speeding up and slowing to a stop",
    easing: "ramp",
    turn: 360,
    anchor: 0,
    rise: null,
    zoom: [1, 1],
  },
  {
    id: "rise",
    label: "Rising sweep",
    title: "Sweeps half way round while the camera rises from low down to looking down on the model",
    easing: "inOut",
    turn: 180,
    anchor: 0.5,
    rise: [4, 50],
    zoom: [1.05, 1],
  },
  {
    id: "crane",
    label: "Crane down",
    title: "Starts high above the model and swings down and round to eye level",
    easing: "inOut",
    turn: 90,
    anchor: 0.5,
    rise: [75, 8],
    zoom: [1.15, 0.95],
  },
  {
    id: "push",
    label: "Push in",
    title: "Arcs a quarter turn while moving in close, ending on your view",
    easing: "out",
    turn: 90,
    anchor: 1,
    rise: [32, 18],
    zoom: [1.6, 0.75],
  },
];

export const movePreset = (id: CameraMoveId) => CAMERA_MOVES.find((m) => m.id === id)!;

/** A preset as a move of `seconds`, with the preset's own easing. */
export const cameraMove = (preset: CameraMoveId, seconds: number): CameraMove => ({ preset, seconds, easing: movePreset(preset).easing });

/** 0 to 1 in, 0 to 1 out, eased. */
export function ease(e: Easing, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (e) {
    case "linear":
      return x;
    case "inOut":
      return (1 - Math.cos(Math.PI * x)) / 2;
    case "ramp":
      // Cubic: a slower start and a stronger rush through the middle than inOut, so the change of speed shows.
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
    case "out":
      return 1 - (1 - x) ** 3;
  }
}

/** The model's middle and the radius of a ball round it, for framing a move. */
export interface Framing {
  centre: V3;
  radius: number;
  /** The picture's width over its height. */
  aspect: number;
}

/** A box round every point of `bodies` (positions placed by each body's column-major 4×4 matrix), as a ball. */
export function framingOf(bodies: readonly { positions: ArrayLike<number>; matrix: ArrayLike<number> }[], aspect: number): Framing | null {
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (const { positions: p, matrix: m } of bodies) {
    for (let i = 0; i + 2 < p.length; i += 3) {
      const x = p[i],
        y = p[i + 1],
        z = p[i + 2];
      const q = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], q[k]);
        hi[k] = Math.max(hi[k], q[k]);
      }
    }
  }
  if (!(lo[0] <= hi[0])) return null;
  const centre: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const radius = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
  return { centre, radius, aspect };
}

/** An orbit keeps your height, but not so high or low that it spins on the spot or looks up through the floor. */
const LEVEL: [number, number] = [2, 60];

/**
 * The camera `t` seconds into `move`, which starts from (or passes through) `from`, your view: it always looks at the
 * middle of the model, from far enough away to frame all of it, as the preset turns, raises and pushes it.
 */
export function cameraAt(move: CameraMove, from: CameraState, framing: Framing, t: number): CameraState {
  const p = movePreset(move.preset);
  const e = ease(move.easing, move.seconds > 0 ? t / move.seconds : 1);
  const framed = fit(from, framing.centre, framing.radius, framing.aspect);
  const lerp = (a: number, b: number) => a + (b - a) * e;
  const elevation = p.rise ? lerp(...p.rise) : Math.min(LEVEL[1], Math.max(LEVEL[0], from.elevation));
  return {
    target: framing.centre,
    azimuth: from.azimuth + p.turn * (e - p.anchor),
    elevation,
    distance: framed.distance * lerp(...p.zoom),
    ortho: false,
    roll: 0,
  };
}
