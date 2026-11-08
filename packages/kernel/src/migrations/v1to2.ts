/**
 * Schema 1 → 2: links (#171). A schema 2 file can hold Link steps, which an older BetterCad can't build. A schema 1
 * file has none, so every body opens in the base link and nothing in the document changes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function v1to2(file: any) {
  return { ...file, schema: 2 };
}
