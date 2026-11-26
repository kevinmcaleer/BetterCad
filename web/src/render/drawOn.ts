/**
 * Draw on: the Render view's build-up animation. Glowing embers trace the model's edges as neon lines, each face
 * shows as a ghost once the edges round it are drawn, and by the end the ghosts have firmed up into the solid model.
 *
 * This module is the plan, framework-free and without three.js: the order the edges are drawn in, when each point of
 * each line is reached, where each ember is at a given moment, and when each face is closed. `drawOnView.ts` plays it.
 */

type V3 = [number, number, number];

/** What the plan needs of a body: its triangles and faces, its B-rep edges, and where it sits (column-major 4×4). */
export interface DrawOnMesh {
  positions: Float32Array;
  indices: Uint32Array;
  faceTris: Uint32Array;
  edgePositions: Float32Array;
  edgeSegs: Uint32Array;
  faceEdgeList?: Uint32Array;
  faceEdgeStart?: Uint32Array;
}

export interface DrawOnBody {
  mesh: DrawOnMesh;
  /** Column-major 4×4 (three's Matrix4.elements); missing is identity. */
  matrix?: ArrayLike<number>;
}

/** How long the animation runs and how many embers draw at once. */
export interface DrawOnTiming {
  /** Seconds the embers take to draw every edge. */
  draw: number;
  /** Embers drawing at once. */
  embers: number;
}

/** Seconds after the last line for the ghosts to firm up, and then to hold the finished model. */
export const SETTLE = 1.6;
export const HOLD = 1.2;
/** Seconds a face takes to fade in as a ghost once its edges are drawn. */
export const GHOST_IN = 0.35;
/** How see-through a fresh ghost is: its share of the solid face. */
export const GHOST = 0.22;
/** Embers fly between lines this many times faster than they draw. */
const FLIGHT = 3;

/** One ember's path: points it passes and when, and whether it draws on the way to each. */
export interface EmberPath {
  points: V3[];
  times: number[];
  /** drawing[i]: the stretch from point i − 1 to point i leaves a line (false is a flight between lines). */
  drawing: boolean[];
}

export interface DrawOnPlan {
  /** Line segments, two points each, in model space (mm, Z up), with the time each end is reached. */
  segments: Float32Array;
  segmentTimes: Float32Array;
  /** Per body, the time each face is closed (its last edge drawn). */
  faceTimes: Float32Array[];
  embers: EmberPath[];
  /** Seconds the drawing takes (the last line), then the whole animation with settling and holding. */
  drawEnd: number;
  total: number;
}

function placed(m: ArrayLike<number> | undefined, x: number, y: number, z: number): V3 {
  if (!m) return [x, y, z];
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

interface Edge {
  body: number;
  index: number;
  points: V3[];
  length: number;
}

/** Each B-rep edge as a polyline of its drawn segments, placed. */
function edgesOf(bodies: readonly DrawOnBody[]): Edge[] {
  const out: Edge[] = [];
  bodies.forEach((b, body) => {
    const { edgePositions: E, edgeSegs: S } = b.mesh;
    for (let i = 0; i + 1 < S.length; i++) {
      const points: V3[] = [];
      for (let s = S[i]; s < S[i + 1]; s++) {
        const a = placed(b.matrix, E[s * 6], E[s * 6 + 1], E[s * 6 + 2]);
        const c = placed(b.matrix, E[s * 6 + 3], E[s * 6 + 4], E[s * 6 + 5]);
        if (!points.length) points.push(a);
        else if (dist(points[points.length - 1], a) > 1e-6) points.push(a); // a break in the polyline: keep both ends
        points.push(c);
      }
      if (points.length < 2) continue;
      let length = 0;
      for (let k = 1; k < points.length; k++) length += dist(points[k - 1], points[k]);
      out.push({ body, index: i, points, length });
    }
  });
  return out;
}

/** Above this many edges the tour takes the cheap order (bottom up) rather than nearest next. */
const GREEDY_LIMIT = 4000;

/**
 * The order to draw the edges in, each one way round: from the lowest edge, always the nearest undrawn end next, so
 * an ember mostly runs on along the model rather than jumping about. Big models go bottom up instead.
 */
export function tour(edges: readonly { points: V3[] }[]): { edge: number; reversed: boolean }[] {
  const n = edges.length;
  if (!n) return [];
  const first = (e: { points: V3[] }) => e.points[0];
  const last = (e: { points: V3[] }) => e.points[e.points.length - 1];
  const low = (e: { points: V3[] }) => Math.min(first(e)[2], last(e)[2]);
  if (n > GREEDY_LIMIT) {
    return edges
      .map((e, i) => ({ i, z: low(e), x: Math.min(first(e)[0], last(e)[0]) }))
      .sort((a, b) => a.z - b.z || a.x - b.x)
      .map(({ i }) => ({ edge: i, reversed: first(edges[i])[2] > last(edges[i])[2] }));
  }
  let start = 0;
  for (let i = 1; i < n; i++) {
    const a = edges[i],
      b = edges[start];
    if (low(a) < low(b) - 1e-6 || (Math.abs(low(a) - low(b)) <= 1e-6 && Math.min(first(a)[0], last(a)[0]) < Math.min(first(b)[0], last(b)[0]))) start = i;
  }
  const done = new Uint8Array(n);
  const order: { edge: number; reversed: boolean }[] = [];
  let at: V3 = first(edges[start])[2] <= last(edges[start])[2] ? first(edges[start]) : last(edges[start]);
  for (let k = 0; k < n; k++) {
    let best = -1,
      bestD = Infinity,
      rev = false;
    for (let i = 0; i < n; i++) {
      if (done[i]) continue;
      const d0 = dist(at, first(edges[i])),
        d1 = dist(at, last(edges[i]));
      if (d0 < bestD) [best, bestD, rev] = [i, d0, false];
      if (d1 < bestD) [best, bestD, rev] = [i, d1, true];
    }
    done[best] = 1;
    order.push({ edge: best, reversed: rev });
    at = rev ? first(edges[best]) : last(edges[best]);
  }
  return order;
}

/** Cuts the tour into `k` runs of about equal work (drawing plus flying), one per ember. */
function split(edges: Edge[], order: { edge: number; reversed: boolean }[], k: number): { edge: number; reversed: boolean }[][] {
  const work = order.map((o) => edges[o.edge].length);
  const total = work.reduce((a, b) => a + b, 0);
  const runs: { edge: number; reversed: boolean }[][] = [[]];
  let acc = 0;
  order.forEach((o, i) => {
    if (acc >= (total * runs.length) / k && runs.length < k && runs[runs.length - 1].length) runs.push([]);
    runs[runs.length - 1].push(o);
    acc += work[i];
  });
  return runs;
}

/** Plans the animation: when each line is drawn, where the embers go, when each face closes. */
export function planDrawOn(bodies: readonly DrawOnBody[], timing: DrawOnTiming): DrawOnPlan {
  const edges = edgesOf(bodies);
  const order = tour(edges);
  const runs = split(edges, order, Math.max(1, Math.min(timing.embers, order.length || 1)));
  // Every ember draws for the same time: its speed suits its run.
  const embers: EmberPath[] = [];
  /** When each edge is finished, per body. */
  const edgeDone = bodies.map((b) => new Float32Array(Math.max(0, b.mesh.edgeSegs.length - 1)));
  const segs: number[] = [];
  const segT: number[] = [];
  for (const run of runs) {
    // Length to cover, where flying counts for less.
    let work = 0;
    let at: V3 | null = null;
    for (const o of run) {
      const e = edges[o.edge];
      const p0 = o.reversed ? e.points[e.points.length - 1] : e.points[0];
      if (at) work += dist(at, p0) / FLIGHT;
      work += e.length;
      at = o.reversed ? e.points[0] : e.points[e.points.length - 1];
    }
    const speed = work > 0 ? work / timing.draw : 1;
    const path: EmberPath = { points: [], times: [], drawing: [] };
    let t = 0;
    at = null;
    for (const o of run) {
      const e = edges[o.edge];
      const pts = o.reversed ? [...e.points].reverse() : e.points;
      if (at) t += dist(at, pts[0]) / FLIGHT / speed;
      path.points.push(pts[0]);
      path.times.push(t);
      path.drawing.push(false);
      for (let i = 1; i < pts.length; i++) {
        const t1 = t + dist(pts[i - 1], pts[i]) / speed;
        segs.push(...pts[i - 1], ...pts[i]);
        segT.push(t, t1);
        path.points.push(pts[i]);
        path.times.push(t1);
        path.drawing.push(true);
        t = t1;
      }
      edgeDone[e.body][e.index] = t;
      at = pts[pts.length - 1];
    }
    if (path.points.length) embers.push(path);
  }
  const drawEnd = embers.reduce((m, p) => Math.max(m, p.times[p.times.length - 1] ?? 0), 0);
  const faceTimes = bodies.map((b, i) => faceClose(b.mesh, edgeDone[i], drawEnd));
  return { segments: new Float32Array(segs), segmentTimes: new Float32Array(segT), faceTimes, embers, drawEnd, total: drawEnd + SETTLE + HOLD };
}

/**
 * When each face is closed: the last of its edges to be drawn. Without the kernel's face–edge lists, a face closes
 * when the last edge that touches one of its corners does, or at the end if none does.
 */
function faceClose(mesh: DrawOnMesh, edgeDone: Float32Array, end: number): Float32Array {
  const faces = Math.max(0, mesh.faceTris.length - 1);
  const out = new Float32Array(faces);
  const { faceEdgeList: L, faceEdgeStart: S } = mesh;
  if (L && S && S.length === faces + 1) {
    for (let f = 0; f < faces; f++) {
      let t = 0;
      for (let k = S[f]; k < S[f + 1]; k++) t = Math.max(t, edgeDone[L[k]] ?? 0);
      out[f] = S[f + 1] > S[f] ? t : end;
    }
    return out;
  }
  // Match the face's corners to edge ends by position.
  const key = (x: number, y: number, z: number) => `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
  const at = new Map<string, number>();
  const E = mesh.edgePositions,
    G = mesh.edgeSegs;
  for (let i = 0; i + 1 < G.length; i++) {
    for (let s = G[i]; s < G[i + 1]; s++) {
      for (const o of [0, 3]) {
        const k = key(E[s * 6 + o], E[s * 6 + o + 1], E[s * 6 + o + 2]);
        at.set(k, Math.max(at.get(k) ?? 0, edgeDone[i]));
      }
    }
  }
  const P = mesh.positions,
    I = mesh.indices;
  for (let f = 0; f < faces; f++) {
    let t = -1;
    for (let tri = mesh.faceTris[f]; tri < mesh.faceTris[f + 1]; tri++) {
      for (let c = 0; c < 3; c++) {
        const v = I[tri * 3 + c];
        const hit = at.get(key(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]));
        if (hit !== undefined) t = Math.max(t, hit);
      }
    }
    out[f] = t < 0 ? end : t;
  }
  return out;
}

/** Where an ember is at time `t`, and whether it is drawing (it fades while flying, and once its run is done). */
export function emberAt(path: EmberPath, t: number): { at: V3; drawing: boolean; done: boolean } {
  const { points: P, times: T } = path;
  if (t <= T[0]) return { at: P[0], drawing: false, done: false };
  if (t >= T[T.length - 1]) return { at: P[P.length - 1], drawing: false, done: true };
  let lo = 0,
    hi = T.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (T[mid] <= t) lo = mid;
    else hi = mid;
  }
  const f = T[hi] > T[lo] ? (t - T[lo]) / (T[hi] - T[lo]) : 1;
  const a = P[lo],
    b = P[hi];
  return { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], drawing: path.drawing[hi], done: false };
}

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/**
 * How solid a face is at time `t`, 0 (ghost) to 1: it starts firming up halfway through the drawing, or once the face
 * closes if that is later, and is solid once the model settles after the last line. A face that closes late eases in
 * from a ghost over what time is left, rather than arriving nearly solid.
 */
export const solidity = (plan: Pick<DrawOnPlan, "drawEnd">, t: number, closed = 0) => smooth(Math.max(plan.drawEnd * 0.5, closed), plan.drawEnd + SETTLE, t);

/** A face's share of the solid face at time `t`, closed at `closed`: nothing, then a ghost, then solid. */
export function faceOpacity(plan: Pick<DrawOnPlan, "drawEnd">, closed: number, t: number): number {
  const shown = smooth(closed, closed + GHOST_IN, t);
  return shown * (GHOST + (1 - GHOST) * solidity(plan, t, closed));
}

/** How bright the lines glow at time `t`: full while drawing, gone once the model is solid, so the end is just the model. */
export const lineGlow = (plan: Pick<DrawOnPlan, "drawEnd">, t: number) => 1 - smooth(plan.drawEnd, plan.drawEnd + SETTLE, t);
