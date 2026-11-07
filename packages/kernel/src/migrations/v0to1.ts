/** Schema 0 → 1: wrap a bare document (epic #2's parts list or the timeline document) in the .bcad header. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function v0to1(doc: any) {
  const epoch = new Date(0).toISOString();
  return { schema: 1, app: "bettercad", version: "0.1.0", created: epoch, modified: epoch, name: String(doc?.name ?? "Untitled model"), document: doc };
}
