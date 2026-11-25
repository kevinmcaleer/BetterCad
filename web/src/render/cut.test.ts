import { describe, expect, it } from "vitest";
import { cutMesh, cutSheet, type Triangles } from "./cut";

/** A closed box from (0,0,0) to `s`, outward winding, with flat normals. */
function box(s: [number, number, number], at: [number, number, number] = [0, 0, 0]): Triangles {
  const pos: number[] = [],
    nrm: number[] = [],
    idx: number[] = [];
  const faces: { n: [number, number, number]; c: [number, number, number][] }[] = [
    {
      n: [0, 0, -1],
      c: [
        [0, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
        [1, 0, 0],
      ],
    },
    {
      n: [0, 0, 1],
      c: [
        [0, 0, 1],
        [1, 0, 1],
        [1, 1, 1],
        [0, 1, 1],
      ],
    },
    {
      n: [0, -1, 0],
      c: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
        [0, 0, 1],
      ],
    },
    {
      n: [0, 1, 0],
      c: [
        [0, 1, 0],
        [0, 1, 1],
        [1, 1, 1],
        [1, 1, 0],
      ],
    },
    {
      n: [-1, 0, 0],
      c: [
        [0, 0, 0],
        [0, 0, 1],
        [0, 1, 1],
        [0, 1, 0],
      ],
    },
    {
      n: [1, 0, 0],
      c: [
        [1, 0, 0],
        [1, 1, 0],
        [1, 1, 1],
        [1, 0, 1],
      ],
    },
  ];
  for (const f of faces) {
    const b = pos.length / 3;
    for (const c of f.c) {
      pos.push(at[0] + c[0] * s[0], at[1] + c[1] * s[1], at[2] + c[2] * s[2]);
      nrm.push(...f.n);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx) };
}

function join(...ms: Triangles[]): Triangles {
  const pos: number[] = [],
    nrm: number[] = [],
    idx: number[] = [];
  for (const m of ms) {
    const b = pos.length / 3;
    pos.push(...m.positions);
    nrm.push(...m.normals);
    idx.push(...Array.from(m.indices, (i) => i + b));
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx) };
}

/** Signed volume of a closed mesh: positive when its winding faces out. */
function volume(m: Triangles): number {
  let v = 0;
  const p = (i: number) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [p(m.indices[t]), p(m.indices[t + 1]), p(m.indices[t + 2])];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

describe("the Render view's section cut", () => {
  it("leaves a mesh the plane misses as it was", () => {
    const m = box([10, 10, 10]);
    expect(cutMesh(m, { point: [0, 0, 20], normal: [0, 0, 1] })).toBe(m);
  });

  it("keeps the side away from the normal and caps the cut, so the half box is closed", () => {
    const m = cutMesh(box([10, 20, 30]), { point: [0, 0, 12], normal: [0, 0, 1] });
    for (let i = 2; i < m.positions.length; i += 3) expect(m.positions[i]).toBeLessThanOrEqual(12 + 1e-4);
    expect(volume(m)).toBeCloseTo(10 * 20 * 12, 2);
  });

  it("cuts at a slant", () => {
    const m = cutMesh(box([10, 10, 10]), { point: [5, 5, 5], normal: [1, 1, 0] });
    expect(volume(m)).toBeCloseTo(500, 2);
  });

  it("leaves a hollow open where the cut goes through it", () => {
    // A 20 mm box with a 10 mm hollow inside: the inner box faces inwards.
    const inner = box([10, 10, 10], [5, 5, 5]);
    const hollow = join(box([20, 20, 20]), { ...inner, indices: inner.indices.slice().reverse() });
    const m = cutMesh(hollow, { point: [0, 0, 10], normal: [0, 0, 1] });
    expect(volume(m)).toBeCloseTo(20 * 20 * 10 - 10 * 10 * 5, 1);
    // The cap is a ring: none of its triangles sit over the hollow.
    for (let t = 0; t < m.indices.length; t += 3) {
      const zs = [0, 1, 2].map((k) => m.positions[m.indices[t + k] * 3 + 2]);
      if (zs.every((z) => Math.abs(z - 10) < 1e-4)) {
        const cx = [0, 1, 2].reduce((a, k) => a + m.positions[m.indices[t + k] * 3], 0) / 3;
        const cy = [0, 1, 2].reduce((a, k) => a + m.positions[m.indices[t + k] * 3 + 1], 0) / 3;
        expect(cx > 5 && cx < 15 && cy > 5 && cy < 15).toBe(false);
      }
    }
  });
});

describe("a picture's sheet under the section cut (#654)", () => {
  // A 10 by 10 mm square at z = 2, the picture stretched over it.
  const sheet = {
    positions: new Float32Array([0, 0, 2, 10, 0, 2, 10, 10, 2, 0, 10, 2]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };

  it("is left as it was when the plane misses it", () => {
    expect(cutSheet(sheet, { point: [20, 0, 0], normal: [1, 0, 0] })).toBe(sheet);
  });

  it("is cut where its body is, and each point keeps its place on the picture", () => {
    const cut = cutSheet(sheet, { point: [4, 0, 0], normal: [1, 0, 0] });
    let area = 0;
    for (let t = 0; t < cut.indices.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => cut.indices[t + k]! * 3);
      const P = cut.positions;
      area += Math.abs((P[b!]! - P[a!]!) * (P[c! + 1]! - P[a! + 1]!) - (P[c!]! - P[a!]!) * (P[b! + 1]! - P[a! + 1]!)) / 2;
    }
    expect(area).toBeCloseTo(40, 4);
    for (let i = 0; i < cut.positions.length / 3; i++) {
      expect(cut.positions[i * 3]).toBeLessThanOrEqual(4 + 1e-6);
      expect(cut.uvs[i * 2]).toBeCloseTo(cut.positions[i * 3]! / 10, 5);
      expect(cut.uvs[i * 2 + 1]).toBeCloseTo(cut.positions[i * 3 + 1]! / 10, 5);
    }
  });

  it("is gone when it is all on the cut side", () => {
    expect(cutSheet(sheet, { point: [-1, 0, 0], normal: [1, 0, 0] }).indices).toHaveLength(0);
  });
});
