import { emberAt, faceOpacity, GHOST, lineGlow, planDrawOn, SETTLE, solidity, tour, type DrawOnMesh } from "./drawOn";

type V3 = [number, number, number];

/** A 10 mm cube as the kernel meshes it: 6 faces of 2 triangles, 12 straight edges, and which edges ring each face. */
function cube(withLists = true): DrawOnMesh {
  const c: V3[] = [
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 0],
    [0, 10, 0],
    [0, 0, 10],
    [10, 0, 10],
    [10, 10, 10],
    [0, 10, 10],
  ];
  const faces = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  const faceTris = [0];
  const faceEdgeList: number[] = [];
  const faceEdgeStart = [0];
  faces.forEach((f, i) => {
    const base = i * 4;
    for (const v of f) positions.push(...c[v]);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    faceTris.push((i + 1) * 2);
    f.forEach((a, k) => {
      const b = f[(k + 1) % 4];
      faceEdgeList.push(edges.findIndex(([p, q]) => (p === a && q === b) || (p === b && q === a)));
    });
    faceEdgeStart.push(faceEdgeList.length);
  });
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    faceTris: new Uint32Array(faceTris),
    edgePositions: new Float32Array(edges.flatMap(([a, b]) => [...c[a], ...c[b]])),
    edgeSegs: new Uint32Array(edges.map((_, i) => i).concat(edges.length)),
    ...(withLists ? { faceEdgeList: new Uint32Array(faceEdgeList), faceEdgeStart: new Uint32Array(faceEdgeStart) } : {}),
  };
}

describe("Draw on plan", () => {
  it("draws every edge once, starting at the bottom", () => {
    const plan = planDrawOn([{ mesh: cube() }], { draw: 6, embers: 1 });
    expect(plan.segmentTimes.length / 2).toBe(12);
    expect(plan.embers).toHaveLength(1);
    expect(plan.embers[0].points[0][2]).toBe(0);
    // Total length 120 mm in 6 s with flights in between: the drawing ends at 6 s.
    expect(plan.drawEnd).toBeCloseTo(6, 5);
    expect(plan.total).toBeGreaterThan(plan.drawEnd + SETTLE);
  });

  it("walks on from each edge to the nearest end, so a cube needs few flights", () => {
    const edges = [
      { points: [[0, 0, 0] as V3, [10, 0, 0] as V3] },
      { points: [[20, 20, 20] as V3, [30, 20, 20] as V3] },
      { points: [[10, 10, 0] as V3, [10, 0, 0] as V3] },
    ];
    expect(tour(edges)).toEqual([
      { edge: 0, reversed: false },
      { edge: 2, reversed: true },
      { edge: 1, reversed: false },
    ]);
  });

  it("closes a face when the last edge round it is drawn", () => {
    const plan = planDrawOn([{ mesh: cube() }], { draw: 6, embers: 1 });
    const times = plan.faceTimes[0];
    expect(times).toHaveLength(6);
    for (const t of times) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThanOrEqual(plan.drawEnd + 1e-6);
    }
    // The bottom face rings the first edges drawn, so it closes before the top.
    expect(times[0]).toBeLessThan(times[1]);
  });

  it("works out when faces close from their corners without the kernel's lists", () => {
    const withLists = planDrawOn([{ mesh: cube() }], { draw: 6, embers: 1 }).faceTimes[0];
    const without = planDrawOn([{ mesh: cube(false) }], { draw: 6, embers: 1 }).faceTimes[0];
    // By corners a face waits for every edge meeting its corners, so never sooner.
    for (let i = 0; i < 6; i++) expect(without[i]).toBeGreaterThanOrEqual(withLists[i] - 1e-6);
  });

  it("shares the edges between embers, which all finish together", () => {
    const plan = planDrawOn([{ mesh: cube() }], { draw: 4, embers: 3 });
    expect(plan.embers).toHaveLength(3);
    for (const e of plan.embers) expect(e.times[e.times.length - 1]).toBeCloseTo(4, 5);
  });

  it("places bodies by their matrix", () => {
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1];
    const plan = planDrawOn([{ mesh: cube(), matrix: m }], { draw: 6, embers: 1 });
    for (let i = 0; i < plan.segments.length; i += 3) expect(plan.segments[i]).toBeGreaterThanOrEqual(100);
  });

  it("plans nothing for no bodies", () => {
    const plan = planDrawOn([], { draw: 6, embers: 3 });
    expect(plan.embers).toEqual([]);
    expect(plan.drawEnd).toBe(0);
  });
});

describe("Draw on timing", () => {
  const plan = { drawEnd: 10 };
  it("moves an ember along its path, drawing", () => {
    const path = { points: [[0, 0, 0] as V3, [10, 0, 0] as V3], times: [0, 2], drawing: [false, true] };
    expect(emberAt(path, 1)).toEqual({ at: [5, 0, 0], drawing: true, done: false });
    expect(emberAt(path, 3).done).toBe(true);
  });
  it("shows a face as nothing, then a ghost, then solid by the end", () => {
    expect(faceOpacity(plan, 2, 1)).toBe(0);
    expect(faceOpacity(plan, 2, 2.5)).toBeCloseTo(GHOST, 5);
    expect(faceOpacity(plan, 2, 10 + SETTLE)).toBeCloseTo(1, 5);
    expect(solidity(plan, 4)).toBe(0);
  });
  it("dims the lines once the model is solid", () => {
    expect(lineGlow(plan, 5)).toBe(1);
    expect(lineGlow(plan, 20)).toBeCloseTo(0.25, 5);
  });
});
