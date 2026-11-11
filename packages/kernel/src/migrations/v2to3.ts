/**
 * Schema 2 → 3: splines in sketches (#269). A schema 3 file can hold spline curves, which an older BetterCad can't
 * draw or build, so it opens with the newer-file warning rather than failing on them. A schema 2 file has none, so
 * nothing in the document changes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function v2to3(file: any) {
  return { ...file, schema: 3 };
}
