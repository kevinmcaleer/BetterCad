import { describe, expect, it } from "vitest";
import { eigen, rpy, sameShapes, type Mat3 } from "./same";

/** A box's 12 triangles from its corner at `lo` to `hi`. */
function box(lo: number[], hi: number[]): number[] {
  const c = (i: number) => [i & 1 ? hi[0]! : lo[0]!, i & 2 ? hi[1]! : lo[1]!, i & 4 ? hi[2]! : lo[2]!];
  const quads = [
    [0, 1, 3, 2],
    [4, 6, 7, 5],
    [0, 4, 5, 1],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 5, 7, 3],
  ];
  return quads.flatMap(([a, b, d, e]) => [...c(a!), ...c(b!), ...c(d!), ...c(a!), ...c(d!), ...c(e!)]);
}

/**
 * An L, a 30 × 10 × 4 bar with a 10 × 20 × 4 leg at one end, with a peg on top of the leg: no turn maps it onto
 * itself or onto its mirror image (a flat L flipped over is its own mirror image; the peg stops that).
 */
const ell = () => [...box([0, 0, 0], [30, 10, 4]), ...box([0, 10, 0], [10, 30, 4]), ...box([0, 25, 4], [5, 30, 9])];

/** Rz(yaw) Ry(pitch) Rx(roll), degrees. */
function turn(roll: number, pitch: number, yaw: number): Mat3 {
  const [a, b, c] = [roll, pitch, yaw].map((d) => (d * Math.PI) / 180) as [number, number, number];
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa, sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa, -sb, cb * sa, cb * ca];
}

function moved(t: number[], m: Mat3, by: number[]): Float32Array {
  const out = new Float32Array(t.length);
  for (let i = 0; i < t.length; i += 3) {
    const [x, y, z] = [t[i]!, t[i + 1]!, t[i + 2]!];
    out[i] = m[0] * x + m[1] * y + m[2] * z + by[0]!;
    out[i + 1] = m[3] * x + m[4] * y + m[5] * z + by[1]!;
    out[i + 2] = m[6] * x + m[7] * y + m[8] * z + by[2]!;
  }
  return out;
}

const body = (name: string, t: number[] | Float32Array) => ({ name, triangles: t instanceof Float32Array ? t : new Float32Array(t) });

describe("bodies of the same shape (one file, printed several times)", () => {
  it("finds a shape's eigen axes, largest spread first, right-handed", () => {
    const { values, vectors } = eigen([1, 0, 0, 0, 9, 0, 0, 0, 4]);
    expect(values).toEqual([9, 4, 1]);
    expect(Math.abs(vectors[3])).toBeCloseTo(1);
  });

  it("reads a turn back as roll, pitch and yaw", () => {
    expect(rpy(turn(10, -20, 135))).toEqual([10, -20, 135]);
    expect(rpy(turn(0, 0, 0))).toEqual([0, 0, 0]);
  });

  it("groups moved and turned copies, and says the turn and move of each", () => {
    const l = ell();
    const t = turn(30, 15, -70);
    const bodies = [body("A", l), body("B", box([0, 0, 0], [5, 6, 7])), body("C", moved(l, t, [100, -20, 7]))];
    const groups = sameShapes(bodies);
    expect(groups.map((g) => g.copies.map((c) => c.index))).toEqual([[0, 2], [1]]);
    const c = groups[0]!.copies[1]!;
    expect(rpy(c.turn)).toEqual([30, 15, -70]);
    c.move.forEach((v, i) => expect(v).toBeCloseTo([100, -20, 7][i]!, 3));
  });

  it("keeps a mirror image of a lopsided part apart, but not of a symmetrical one", () => {
    const mirror: Mat3 = [-1, 0, 0, 0, 1, 0, 0, 0, 1];
    const l = ell();
    expect(sameShapes([body("L", l), body("L mirrored", moved(l, mirror, [0, 0, 0]))])).toHaveLength(2);
    const bar = [...box([0, 0, 0], [30, 10, 4]), ...box([10, 10, 0], [20, 25, 4])];
    const groups = sameShapes([body("T", bar), body("T mirrored", moved(bar, mirror, [80, 0, 0]))]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.copies).toHaveLength(2);
  });

  it("leaves different shapes apart", () => {
    const groups = sameShapes([body("a", box([0, 0, 0], [30, 20, 10])), body("b", box([0, 0, 0], [30, 20, 11]))]);
    expect(groups).toHaveLength(2);
  });
});
