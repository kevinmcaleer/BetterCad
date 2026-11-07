/**
 * What the kernel hands the viewport: one body's triangles, grouped by B-rep face, plus its edges as line
 * segments and its vertices as points. The viewport only ever draws these; it never computes geometry.
 *
 * Every face owns its own vertices (no vertex is shared between two faces), so a per-vertex attribute can
 * carry a face's ID or colour.
 */
export interface BodyMesh {
  /** x, y, z per vertex, in millimetres. */
  positions: Float32Array;
  /** One unit normal per vertex. */
  normals: Float32Array;
  /** Three vertex indices per triangle. */
  indices: Uint32Array;
  /** Face i owns triangles faceTris[i] .. faceTris[i + 1] - 1 (length: faces + 1). */
  faceTris: Uint32Array;
  /** Face i owns vertices faceVerts[i] .. faceVerts[i + 1] - 1 (length: faces + 1). */
  faceVerts: Uint32Array;
  /** Pairs of points, x, y, z each: every edge drawn as line segments. */
  edgePositions: Float32Array;
  /** Edge i owns segments edgeSegs[i] .. edgeSegs[i + 1] - 1 (length: edges + 1). */
  edgeSegs: Uint32Array;
  /** x, y, z per topological vertex (a box has 8, a cylinder none). */
  vertices: Float32Array;
}

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

export const faceCount = (m: BodyMesh) => m.faceTris.length - 1;
export const edgeCount = (m: BodyMesh) => m.edgeSegs.length - 1;
export const vertexCount = (m: BodyMesh) => m.vertices.length / 3;
export const triangleCount = (m: BodyMesh) => m.indices.length / 3;

/** The axis-aligned box round a mesh's vertices. */
export function meshBounds(m: BodyMesh): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const p = m.positions;
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min, max };
}

/** The volume a closed mesh holds, by the divergence theorem (mm³). */
export function meshVolume(m: BodyMesh): number {
  const p = m.positions;
  const ix = m.indices;
  let v = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t]! * 3;
    const b = ix[t + 1]! * 3;
    const c = ix[t + 2]! * 3;
    const ax = p[a]!,
      ay = p[a + 1]!,
      az = p[a + 2]!;
    const bx = p[b]!,
      by = p[b + 1]!,
      bz = p[b + 2]!;
    const cx = p[c]!,
      cy = p[c + 1]!,
      cz = p[c + 2]!;
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

/** Builds a BodyMesh face by face. Each face's vertices stay its own. */
export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private idx: number[] = [];
  private faceTris = [0];
  private faceVerts = [0];
  private edges: number[] = [];
  private edgeSegs = [0];
  private verts: number[] = [];

  /** Starts a face; returns the index of its first vertex. */
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  endFace(): void {
    this.faceTris.push(this.idx.length / 3);
    this.faceVerts.push(this.pos.length / 3);
  }
  /** An edge as a polyline through points (x, y, z each). */
  edge(points: number[]): void {
    for (let i = 0; i + 5 < points.length; i += 3) this.edges.push(...points.slice(i, i + 6));
    this.edgeSegs.push(this.edges.length / 6);
  }
  point(x: number, y: number, z: number): void {
    this.verts.push(x, y, z);
  }
  build(): BodyMesh {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nor),
      indices: new Uint32Array(this.idx),
      faceTris: new Uint32Array(this.faceTris),
      faceVerts: new Uint32Array(this.faceVerts),
      edgePositions: new Float32Array(this.edges),
      edgeSegs: new Uint32Array(this.edgeSegs),
      vertices: new Float32Array(this.verts),
    };
  }
}
