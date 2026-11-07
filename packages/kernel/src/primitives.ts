import { MeshBuilder, type BodyMesh } from "./mesh";

/**
 * Exact tessellations of the placeholder parts (box, cylinder, sphere), so the viewport has real triangles before
 * OpenCascade arrives. Each sits on the XY plane: x and y centred on the origin, z from 0 up. Sizes in mm.
 * The OCCT worker (#4) produces the same BodyMesh shape for every solid.
 */
export type PrimitiveKind = "box" | "cylinder" | "sphere";

export interface Size3 {
  x: number;
  y: number;
  z: number;
}

/** Segments round a full circle for a given quality. */
export const SEGMENTS = { draft: 32, fine: 96 } as const;
export type Quality = keyof typeof SEGMENTS;

type V3 = [number, number, number];

function quad(b: MeshBuilder, corners: [V3, V3, V3, V3], n: V3): void {
  const i = corners.map((c) => b.vertex(c[0], c[1], c[2], n[0], n[1], n[2]));
  b.tri(i[0]!, i[1]!, i[2]!);
  b.tri(i[0]!, i[2]!, i[3]!);
  b.endFace();
}

/** A box: faces bottom, top, front (−Y), back (+Y), left (−X), right (+X); 12 edges; 8 vertices. */
export function boxMesh({ x: w, y: d, z: h }: Size3): BodyMesh {
  const b = new MeshBuilder();
  const x0 = -w / 2,
    x1 = w / 2,
    y0 = -d / 2,
    y1 = d / 2,
    z0 = 0,
    z1 = h;
  quad(
    b,
    [
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y0, z0],
    ],
    [0, 0, -1],
  );
  quad(
    b,
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    [0, 0, 1],
  );
  quad(
    b,
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
    ],
    [0, -1, 0],
  );
  quad(
    b,
    [
      [x1, y1, z0],
      [x0, y1, z0],
      [x0, y1, z1],
      [x1, y1, z1],
    ],
    [0, 1, 0],
  );
  quad(
    b,
    [
      [x0, y1, z0],
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
    ],
    [-1, 0, 0],
  );
  quad(
    b,
    [
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x1, y0, z1],
    ],
    [1, 0, 0],
  );
  const c: V3[] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const pairs = [
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
  for (const [a, e] of pairs) b.edge([...c[a!]!, ...c[e!]!]);
  for (const p of c) b.point(p[0], p[1], p[2]);
  return b.build();
}

/** A cylinder (elliptical when x ≠ y): faces side, top, bottom; edges top and bottom rims; no vertices. */
export function cylinderMesh({ x, y, z: h }: Size3, quality: Quality = "fine"): BodyMesh {
  const n = SEGMENTS[quality];
  const rx = x / 2,
    ry = y / 2;
  const b = new MeshBuilder();
  const ring = (k: number): [number, number, number, number] => {
    const a = (k / n) * Math.PI * 2;
    const c = Math.cos(a),
      s = Math.sin(a);
    // The ellipse's normal: the gradient of x²/rx² + y²/ry².
    const nx = c / rx,
      ny = s / ry,
      l = Math.hypot(nx, ny);
    return [rx * c, ry * s, nx / l, ny / l];
  };
  // Side: a strip of quads, a low and a high vertex per step.
  for (let k = 0; k <= n; k++) {
    const [px, py, nx, ny] = ring(k);
    const lo = b.vertex(px, py, 0, nx, ny, 0);
    b.vertex(px, py, h, nx, ny, 0);
    if (k > 0) {
      b.tri(lo - 2, lo, lo + 1);
      b.tri(lo - 2, lo + 1, lo - 1);
    }
  }
  b.endFace();
  // Caps
  for (const [z, nz] of [
    [h, 1],
    [0, -1],
  ] as const) {
    const centre = b.vertex(0, 0, z, 0, 0, nz);
    for (let k = 0; k < n; k++) {
      const [px, py] = ring(k);
      b.vertex(px, py, z, 0, 0, nz);
    }
    for (let k = 0; k < n; k++) {
      const a = centre + 1 + k;
      const c = centre + 1 + ((k + 1) % n);
      if (nz > 0) b.tri(centre, a, c);
      else b.tri(centre, c, a);
    }
    b.endFace();
  }
  for (const z of [h, 0]) {
    const pts: number[] = [];
    for (let k = 0; k <= n; k++) {
      const [px, py] = ring(k);
      pts.push(px, py, z);
    }
    b.edge(pts);
  }
  return b.build();
}

/** A sphere (an ellipsoid when the sizes differ) resting on z = 0: one face, no edges, no vertices. */
export function sphereMesh({ x, y, z }: Size3, quality: Quality = "fine"): BodyMesh {
  const seg = SEGMENTS[quality];
  const rings = seg / 2;
  const rx = x / 2,
    ry = y / 2,
    rz = z / 2;
  const b = new MeshBuilder();
  for (let i = 0; i <= rings; i++) {
    const v = (i / rings) * Math.PI;
    for (let j = 0; j <= seg; j++) {
      const u = (j / seg) * Math.PI * 2;
      const ux = Math.sin(v) * Math.cos(u),
        uy = Math.sin(v) * Math.sin(u),
        uz = -Math.cos(v);
      const nx = ux / rx,
        ny = uy / ry,
        nz = uz / rz,
        l = Math.hypot(nx, ny, nz) || 1;
      b.vertex(rx * ux, ry * uy, rz + rz * uz, nx / l, ny / l, nz / l);
    }
  }
  const row = seg + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * row + j,
        c = a + row;
      if (i > 0) b.tri(a, a + 1, c + 1);
      if (i < rings - 1) b.tri(a, c + 1, c);
    }
  }
  b.endFace();
  return b.build();
}

export function primitiveMesh(kind: PrimitiveKind, size: Size3, quality: Quality = "fine"): BodyMesh {
  if (kind === "box") return boxMesh(size);
  if (kind === "cylinder") return cylinderMesh(size, quality);
  return sphereMesh(size, quality);
}
