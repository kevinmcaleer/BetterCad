/**
 * The clash sweep (#179): turn or slide each joint through its range, the others held where they are, and find where
 * bodies hit, an arm hitting itself included. Every sample uses the fast mesh test; the exact check (the caller's
 * `confirm`, from the kernel) only settles the ends of each range. Or sample every joint together, up to a count.
 */
import { meshesClash, rigidInverse, type MeshTree } from "./collide";
import { resolvePose, type PoseDrive } from "./drivelinks";
import { IDENTITY, jointValue, linkTransforms, mat4Mul, movable, type Mat4, type Pose, type PoseJoint } from "./pose";
import { KernelError } from "./errors";

export interface SweepBody {
  id: string;
  link?: string;
  tree: MeshTree;
}

export interface SweepOptions {
  /** A joint's id to sweep just that one, "each" for every joint in turn (the default), or "together". */
  joint?: string;
  /** Degrees between samples for a hinge or wheel, mm for a slider; 5° and 1 mm when left out. */
  step?: { hinge?: number; slider?: number };
  /** "together" only: how many poses to try, 200 when left out. */
  samples?: number;
  cancelled?: () => boolean;
  progress?: (fraction: number) => void;
}

/** Two bodies that hit while one joint moves from `from` to `to`; `first` is the end nearest where it is now. */
export interface SweepRange {
  joint: string;
  a: string;
  b: string;
  from: number;
  to: number;
  first: number;
  /** The pose at `first`, to show. */
  at: Pose;
}

/** Two bodies that hit in `count` of the poses tried together; `at` is the one of them nearest the pose now. */
export interface SweepPair {
  a: string;
  b: string;
  count: number;
  at: Pose;
}

/** A limit that keeps the joint clear of every range it has, where it can be had. */
export interface SweepLimit {
  joint: string;
  lower?: number;
  upper?: number;
}

export interface SweepResult {
  /** Poses tried with the mesh test. */
  samples: number;
  ranges: SweepRange[];
  together: SweepPair[];
  limits: SweepLimit[];
}

/** The exact check at a pose: whether two bodies really share some volume there. */
export type Confirm = (a: SweepBody, b: SweepBody, links: Map<string, Mat4>) => boolean;

export const SWEEP_STEP = { hinge: 5, slider: 1 };
export const SWEEP_SAMPLES = 200;

const rangeOf = (j: PoseJoint): [number, number] => (j.kind === "continuous" ? [-180, 180] : [Math.min(j.lower, j.upper), Math.max(j.lower, j.upper)]);

const close = (a: Mat4, b: Mat4) => a.every((v, i) => Math.abs(v - b[i]!) < 1e-9);

/** Joints a sweep can move: not fixed, and not driven by another (they move with their driver). */
export function sweepable(joints: PoseJoint[], drives: PoseDrive[]): PoseJoint[] {
  const driven = new Set(drives.map((d) => d.driven));
  return joints.filter((j) => movable(j) && !driven.has(j.id));
}

/** Where body `b` sits in body `a`'s frame. */
function relative(links: Map<string, Mat4>, a: SweepBody, b: SweepBody): Mat4 {
  const ma = (a.link && links.get(a.link)) || IDENTITY;
  const mb = (b.link && links.get(b.link)) || IDENTITY;
  return mat4Mul(rigidInverse(ma), mb);
}

/** Pairs of bodies in different links, by index. */
function pairsOf(bodies: SweepBody[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < bodies.length; i++)
    for (let k = i + 1; k < bodies.length; k++) if ((bodies[i]!.link ?? null) !== (bodies[k]!.link ?? null)) out.push([i, k]);
  return out;
}

export function sweepClashes(
  joints: PoseJoint[],
  drives: PoseDrive[],
  pose: Pose | undefined,
  bodies: SweepBody[],
  confirm: Confirm,
  opts: SweepOptions = {},
): SweepResult {
  const free = sweepable(joints, drives);
  const linksAt = (p: Pose) => linkTransforms(joints, resolvePose(drives, p));
  const pairs = pairsOf(bodies);
  const base: Pose = { ...pose };
  const check = () => {
    if (opts.cancelled?.()) throw new KernelError("cancelled", "Stopped.");
  };
  if (opts.joint === "together") return together(free, base, bodies, pairs, linksAt, confirm, opts, check);

  const chosen = opts.joint && opts.joint !== "each" ? free.filter((j) => j.id === opts.joint) : free;
  const stepOf = (j: PoseJoint) =>
    j.kind === "prismatic" ? Math.abs(opts.step?.slider ?? 0) || SWEEP_STEP.slider : Math.abs(opts.step?.hinge ?? 0) || SWEEP_STEP.hinge;
  const valuesOf = (j: PoseJoint) => {
    const [lo, hi] = rangeOf(j);
    const step = stepOf(j);
    const out: number[] = [];
    for (let v = lo; v < hi - 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
    out.push(hi);
    return out;
  };
  const total = chosen.reduce((n, j) => n + valuesOf(j).length, 0) || 1;
  let done = 0;
  const ranges: SweepRange[] = [];
  const limits: SweepLimit[] = [];
  for (const j of chosen) {
    const values = valuesOf(j);
    const now = jointValue(j, base);
    const at = (v: number): Pose => ({ ...base, [j.id]: v });
    const home = linksAt(base);
    // Only pairs this joint moves against each other can change.
    const probe = [values[0]!, values[values.length >> 1]!, values[values.length - 1]!].map((v) => linksAt(at(v)));
    const live = pairs.filter(([i, k]) => {
      const r0 = relative(home, bodies[i]!, bodies[k]!);
      return probe.some((l) => !close(r0, relative(l, bodies[i]!, bodies[k]!)));
    });
    const hits = live.map(() => new Array<boolean>(values.length).fill(false));
    values.forEach((v, s) => {
      check();
      const links = linksAt(at(v));
      live.forEach(([i, k], p) => {
        hits[p]![s] = meshesClash(bodies[i]!.tree, bodies[k]!.tree, relative(links, bodies[i]!, bodies[k]!));
      });
      done++;
      opts.progress?.(done / total);
    });
    const step = stepOf(j);
    const res = Math.min(0.1, step / 8);
    live.forEach(([i, k], p) => {
      const a = bodies[i]!;
      const b = bodies[k]!;
      const meshHit = (v: number) => meshesClash(a.tree, b.tree, relative(linksAt(at(v)), a, b));
      const exact = (v: number) => confirm(a, b, linksAt(at(v)));
      // The edge between a clear value and a hitting one, to within `res`, by halving.
      const edge = (clear: number, hit: number) => {
        while (Math.abs(hit - clear) > res) {
          const mid = (clear + hit) / 2;
          if (meshHit(mid)) hit = mid;
          else clear = mid;
        }
        return Math.round(hit * 100) / 100;
      };
      const row = hits[p]!;
      for (let s = 0; s < values.length; s++) {
        if (!row[s]) continue;
        let e = s;
        while (e + 1 < values.length && row[e + 1]) e++;
        const from = s > 0 ? edge(values[s - 1]!, values[s]!) : values[s]!;
        const to = e < values.length - 1 ? edge(values[e + 1]!, values[e]!) : values[e]!;
        s = e;
        // The kernel confirms each end: just inside it, then further in, until the exact check agrees. Right at an
        // end the overlap can be too thin to count, so the ends stay where the mesh test put them (it errs on the side
        // of a clash), and a range neither end confirms is dropped.
        const confirmed = (start: number, toward: number) => {
          const span = toward - start;
          const tries = [start];
          for (let d = res; d < Math.abs(span); d *= 4) tries.push(start + Math.sign(span) * d);
          if (Math.abs(span) > 1e-9) tries.push(toward);
          return tries.slice(0, 6).some(exact);
        };
        if (!confirmed(from, to) && !confirmed(to, from)) continue;
        const first = now < from ? from : now > to ? to : now;
        ranges.push({ joint: j.id, a: a.id, b: b.id, from, to, first, at: at(first) });
      }
    });
    // A limit that keeps clear of the nearest range on each side, in whole degrees or mm, if it narrows the range.
    if (j.kind === "revolute" || j.kind === "prismatic") {
      const mine = ranges.filter((r) => r.joint === j.id);
      if (!mine.some((r) => r.from <= now && now <= r.to)) {
        const [lo, hi] = rangeOf(j);
        const above = mine.filter((r) => r.from > now).map((r) => r.from);
        const below = mine.filter((r) => r.to < now).map((r) => r.to);
        const limit: SweepLimit = { joint: j.id };
        if (above.length) {
          const u = Math.floor(Math.min(...above) - res);
          if (u >= now && u < hi) limit.upper = u;
        }
        if (below.length) {
          const l = Math.ceil(Math.max(...below) + res);
          if (l <= now && l > lo) limit.lower = l;
        }
        if (limit.upper !== undefined || limit.lower !== undefined) limits.push(limit);
      }
    }
  }
  opts.progress?.(1);
  return { samples: done, ranges, together: [], limits };
}

/** A low-discrepancy point in [0, 1): the radical inverse of `i` in base `b`, so samples spread evenly. */
function halton(i: number, b: number): number {
  let f = 1;
  let r = 0;
  for (let n = i; n > 0; n = Math.floor(n / b)) {
    f /= b;
    r += f * (n % b);
  }
  return r;
}

const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71];

function together(
  free: PoseJoint[],
  base: Pose,
  bodies: SweepBody[],
  pairs: [number, number][],
  linksAt: (p: Pose) => Map<string, Mat4>,
  confirm: Confirm,
  opts: SweepOptions,
  check: () => void,
): SweepResult {
  const n = Math.max(1, Math.round(opts.samples ?? SWEEP_SAMPLES));
  const spans = free.map(rangeOf);
  const now = free.map((j) => jointValue(j, base));
  const home = linksAt(base);
  const r0 = pairs.map(([i, k]) => relative(home, bodies[i]!, bodies[k]!));
  const found = pairs.map(() => ({ count: 0, moved: false, best: [] as { d: number; pose: Pose }[] }));
  for (let s = 0; s < n; s++) {
    check();
    const pose: Pose = { ...base };
    let d = 0;
    free.forEach((j, q) => {
      const [lo, hi] = spans[q]!;
      const v = Math.round((lo + (hi - lo) * halton(s + 1, PRIMES[q % PRIMES.length]!)) * 10) / 10;
      pose[j.id] = v;
      d += ((v - now[q]!) / (hi - lo || 1)) ** 2;
    });
    const links = linksAt(pose);
    pairs.forEach(([i, k], p) => {
      const m = relative(links, bodies[i]!, bodies[k]!);
      const f = found[p]!;
      if (!close(m, r0[p]!)) f.moved = true;
      if (!meshesClash(bodies[i]!.tree, bodies[k]!.tree, m)) return;
      f.count++;
      // Keep the few nearest the pose now, to confirm.
      f.best.push({ d, pose });
      f.best.sort((x, y) => x.d - y.d);
      if (f.best.length > 4) f.best.pop();
    });
    opts.progress?.((s + 1) / n);
  }
  const out: SweepPair[] = [];
  pairs.forEach(([i, k], p) => {
    const f = found[p]!;
    // A pair that never moves against the other is the clash check's, not the sweep's.
    if (!f.count || !f.moved) return;
    const hit = f.best.find((b) => confirm(bodies[i]!, bodies[k]!, linksAt(b.pose)));
    if (hit) out.push({ a: bodies[i]!.id, b: bodies[k]!.id, count: f.count, at: hit.pose });
  });
  opts.progress?.(1);
  return { samples: n, ranges: [], together: out.sort((x, y) => y.count - x.count), limits: [] };
}
