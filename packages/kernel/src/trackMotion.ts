import type { BuiltLink, BuiltTrack } from "./document";
import { IDENTITY, jointValue, mat4InvertRigid, mat4Mul, type Mat4, type Pose, type PoseJoint } from "./pose";
import { layTrack, type P2 } from "./track";

/**
 * Tracks running round their wheels as the wheels turn (posing and Play): each piece slides along the loop by as much as
 * the driving wheel's rim travels, without a rebuild. Kept out of the document code the app loads first.
 */

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The wheel that drives a track: its joint, its rim's radius (lift included), and which way round it runs the loop. */
export interface TrackDrive {
  joint: PoseJoint;
  radius: number;
  /** +1 when turning the joint forward runs the pieces forward round the loop, -1 when back. */
  sign: number;
}

/**
 * The first wheel the track goes round that turns on a hinge or wheel joint about its own axle, or null when none does.
 * A wheel in the same component as the pieces doesn't count: they would turn with it.
 */
export function trackDrive(t: BuiltTrack, joints: PoseJoint[], links: BuiltLink[]): TrackDrive | null {
  const linkOf = (body: string) => links.find((l) => l.parts.includes(body))?.id;
  const own = linkOf(t.parts[0]!);
  const W = unit(t.wheels[0]!.normal as V3);
  for (let i = 0; i < t.track.wheels.length; i++) {
    const ref = t.track.wheels[i]!;
    const link = "body" in ref ? linkOf(ref.body) : undefined;
    if (!link || link === own) continue;
    const joint = joints.find((j) => j.child === link && (j.kind === "continuous" || j.kind === "revolute"));
    if (!joint) continue;
    const along = dot(unit(joint.axis as V3), W);
    if (Math.abs(along) < 0.9) continue;
    return { joint, radius: t.wheels[i]!.radius + t.track.lift, sign: Math.sign(along) };
  }
  return null;
}

const homes = new WeakMap<BuiltTrack, { pieces: Mat4[]; step: number }>();

/** The track laid where it was built, and how far round the loop its first piece goes to reach the second's place. */
function homeOf(t: BuiltTrack): { pieces: Mat4[]; step: number } {
  let h = homes.get(t);
  if (h) return h;
  const lay = layTrack(t.track, t.piece, t.wheels);
  let step = lay.pitch;
  if (lay.pivots.length > 1) {
    // The pieces are a chord apart, so on a bend the loop between them is a little longer: find it by halving.
    const a = lay.pivots[0] as P2;
    const gap = (d: number) => {
      const p = layTrack({ ...t.track, count: 1, offset: t.track.offset + d }, t.piece, t.wheels).pivots[0];
      return p ? Math.hypot(p[0] - a[0], p[1] - a[1]) : 0;
    };
    let lo = lay.pitch * 0.999;
    let hi = lay.pitch * 2;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (gap(mid) < lay.pitch) lo = mid;
      else hi = mid;
    }
    step = (lo + hi) / 2;
  }
  h = { pieces: lay.pieces, step };
  homes.set(t, h);
  return h;
}

/** How far round the loop the track runs before each piece is where the next one was. */
export const trackStep = (t: BuiltTrack) => homeOf(t).step;

/**
 * Each piece's move from where it was built, with the track run `s` mm round the loop (forward is anticlockwise about
 * the first wheel's axle). A piece that passes the next one's place takes it over, so the loop never runs out.
 */
export function slideTrack(t: BuiltTrack, s: number): Mat4[] {
  const home = homeOf(t);
  const n = home.pieces.length;
  if (!n || n !== t.parts.length || !Number.isFinite(s)) return t.parts.map(() => IDENTITY.slice());
  const passed = Math.floor(s / home.step);
  const now = layTrack({ ...t.track, offset: t.track.offset + (s - passed * home.step) }, t.piece, t.wheels);
  if (now.pieces.length !== n) return t.parts.map(() => IDENTITY.slice());
  const k = ((passed % n) + n) % n;
  return home.pieces.map((h, i) => mat4Mul(now.pieces[(i + k) % n]!, mat4InvertRigid(h)));
}

/**
 * A continuous wheel's value only runs -180° to 180°; this keeps count of whole turns so a track doesn't jump back when
 * the wheel goes round past 180°. Back at 0 (home), the count starts again.
 */
export class WheelTurns {
  private last = new Map<string, { at: number; total: number }>();

  of(j: PoseJoint, pose: Pose | undefined): number {
    const v = jointValue(j, pose);
    if (j.kind !== "continuous" || v === 0) {
      this.last.set(j.id, { at: v, total: v });
      return v;
    }
    const was = this.last.get(j.id) ?? { at: 0, total: 0 };
    let d = v - was.at;
    d -= 360 * Math.round(d / 360);
    const total = was.total + d;
    this.last.set(j.id, { at: v, total });
    return total;
  }
}

/**
 * Where every track's pieces are drawn in the pose: their component's move, then their run round the loop. Only
 * tracks whose driving wheel has turned are listed, by body id.
 */
export function trackMoves(
  tracks: BuiltTrack[],
  joints: PoseJoint[],
  links: BuiltLink[],
  pose: Pose | undefined,
  linkMoves: Map<string, Mat4>,
  turns: WheelTurns,
): Map<string, Mat4> {
  const out = new Map<string, Mat4>();
  for (const t of tracks) {
    const drive = trackDrive(t, joints, links);
    if (!drive) continue;
    const s = ((turns.of(drive.joint, pose) * Math.PI) / 180) * drive.radius * drive.sign;
    if (!s) continue;
    const link = links.find((l) => l.parts.includes(t.parts[0]!))?.id;
    const carry = (link && linkMoves.get(link)) || IDENTITY;
    slideTrack(t, s).forEach((m, i) => out.set(t.parts[i]!, mat4Mul(carry, m)));
  }
  return out;
}
