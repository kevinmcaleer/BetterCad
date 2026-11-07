/** A binary STL reader for the end-to-end tests (#107): the triangles, and the volume they hold. */
export function readStl(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = view.getUint32(80, true);
  if (bytes.byteLength !== 84 + 50 * n) throw new Error(`Not a binary STL: ${n} triangles in ${bytes.byteLength} bytes`);
  const out = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    // 12 bytes of normal, then three corners of three floats.
    for (let k = 0; k < 9; k++) out[t * 9 + k] = view.getFloat32(84 + t * 50 + 12 + k * 4, true);
  }
  return out;
}

/** The signed volume of the tetrahedra from the origin to each triangle, summed: a closed mesh's volume. */
export function stlVolume(t: Float32Array): number {
  let v = 0;
  for (let i = 0; i < t.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [t[i]!, t[i + 1]!, t[i + 2]!, t[i + 3]!, t[i + 4]!, t[i + 5]!, t[i + 6]!, t[i + 7]!, t[i + 8]!];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}
