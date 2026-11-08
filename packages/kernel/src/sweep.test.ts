import { describe, expect, it } from "vitest";
import { meshTree, meshesClash, trianglesCross } from "./collide";
import { sweepClashes, type SweepBody } from "./sweep";
import { IDENTITY, type PoseJoint } from "./pose";

type V3 = [number, number, number];

/** A box's 12 triangles, wound outward. */
function boxTris(min: V3, max: V3): Float32Array {
  const c = (i: number): V3 => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
  const quads = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  const out: number[] = [];
  for (const [a, b, d, e] of quads) out.push(...c(a!), ...c(b!), ...c(d!), ...c(a!), ...c(d!), ...c(e!));
  return new Float32Array(out);
}

const shift = (x: number, y = 0, z = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

describe("mesh clash test (#179)", () => {
  const cube = meshTree(boxTris([0, 0, 0], [10, 10, 10]));
  const small = meshTree(boxTris([4, 4, 4], [6, 6, 6]));

  it("finds crossing boxes and leaves apart ones and touching ones out", () => {
    expect(meshesClash(cube, cube, shift(5))).toBe(true);
    expect(meshesClash(cube, cube, shift(20))).toBe(false);
    // Sharing a face is touching, not a clash.
    expect(meshesClash(cube, cube, shift(10))).toBe(false);
    expect(meshesClash(cube, cube, shift(10, 3, 3))).toBe(false);
  });

  it("finds a box wholly inside another, either way round", () => {
    expect(meshesClash(cube, small, IDENTITY)).toBe(true);
    expect(meshesClash(small, cube, IDENTITY)).toBe(true);
  });

  it("doesn't count coplanar triangles as crossing", () => {
    const p = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ];
    expect(
      trianglesCross(p, [
        [0.2, 0.2, 0],
        [2, 0.2, 0],
        [0.2, 2, 0],
      ]),
    ).toBe(false);
    expect(
      trianglesCross(p, [
        [0.2, 0.2, -1],
        [0.2, 0.2, 1],
        [0.3, 0.3, 1],
      ]),
    ).toBe(true);
  });
});

describe("clash sweep (#179)", () => {
  // A base block 40 × 40 × 20 at the origin, and an arm 60 long, 10 square, hung on a hinge at (0, 0, 30) about Y.
  // Turning it down, its underside meets the base's top edge at x = 20 when 10 cos θ − 20 sin θ = 5: θ ≈ 13.65°.
  const bodies: SweepBody[] = [
    { id: "base", tree: meshTree(boxTris([-20, -20, 0], [20, 20, 20])) },
    { id: "arm", link: "upper", tree: meshTree(boxTris([0, -5, 25], [60, 5, 35])) },
  ];
  const joint: PoseJoint = { id: "shoulder", kind: "revolute", child: "upper", parent: null, origin: [0, 0, 30], axis: [0, 1, 0], lower: -90, upper: 90 };
  const theta = 77.0786 - 63.4349;

  it("finds the angle where the arm hits the base, and a limit that clears it", () => {
    const confirmed: number[] = [];
    const r = sweepClashes([joint], [], {}, bodies, (_a, _b, links) => {
      confirmed.push(links.size);
      return true;
    });
    expect(r.ranges).toHaveLength(1);
    const [hit] = r.ranges;
    expect(hit).toMatchObject({ joint: "shoulder", a: "base", b: "arm", to: 90 });
    expect(Math.abs(hit!.from - theta)).toBeLessThan(0.15);
    expect(hit!.first).toBe(hit!.from);
    expect(hit!.at).toEqual({ shoulder: hit!.from });
    expect(confirmed.length).toBeGreaterThan(0);
    expect(r.limits).toEqual([{ joint: "shoulder", upper: 13 }]);
    // The suggested limit clears it: nothing hits from −90° to 13°.
    const again = sweepClashes([{ ...joint, upper: 13 }], [], {}, bodies, () => true);
    expect(again.ranges).toEqual([]);
    expect(r.samples).toBe(37);
  });

  it("drops a range the exact check doesn't agree with", () => {
    const r = sweepClashes([joint], [], {}, bodies, () => false);
    expect(r.ranges).toEqual([]);
    expect(r.limits).toEqual([]);
  });

  it("sweeps at the step asked for, and skips a pose that already clashes", () => {
    expect(sweepClashes([joint], [], {}, bodies, () => true, { step: { hinge: 10 } }).samples).toBe(19);
    const r = sweepClashes([joint], [], { shoulder: 45 }, bodies, () => true);
    expect(r.ranges[0]!.first).toBe(45);
    expect(r.limits).toEqual([]);
  });

  it("samples every joint together, up to the count asked for", () => {
    let seen = 0;
    const r = sweepClashes([joint], [], {}, bodies, () => true, { joint: "together", samples: 50, progress: () => seen++ });
    expect(r.samples).toBe(50);
    expect(r.together).toHaveLength(1);
    expect(r.together[0]).toMatchObject({ a: "base", b: "arm" });
    expect(r.together[0]!.at.shoulder).toBeGreaterThan(theta);
    expect(seen).toBeGreaterThanOrEqual(50);
  });

  it("stops when cancelled", () => {
    expect(() => sweepClashes([joint], [], {}, bodies, () => true, { cancelled: () => true })).toThrow("Stopped.");
  });
});
