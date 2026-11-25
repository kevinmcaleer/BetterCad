import type { ComponentDef } from "@bettercad/electronics";

/**
 * The files your parts' 3D bodies come from (#628): STEP files, base64, by the hash of their bytes. They are kept in
 * this browser beside your parts, and in your account's files when you are signed in, the way a model's imports are.
 * A design that uses such a part gets its own copy in the model's blobs, so the model opens without your library.
 */
const held = new Map<string, string>();
let loading: Promise<void> | null = null;

// A database of its own, so adding it never asks the app's main database to upgrade under an open tab.
const DB = "bettercad-parts";
const STORE = "files";
let opening: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ??= new Promise<IDBDatabase | null>((resolve) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.onblocked = () => resolve(null);
  });
  return opening;
}
const done = <R>(r: IDBRequest<R>) =>
  new Promise<R>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const store = () => ({
  set: async (k: string, v: string) => {
    const d = await db();
    if (d) await done(d.transaction(STORE, "readwrite").objectStore(STORE).put(v, k));
  },
  entries: async (): Promise<[string, string][]> => {
    const d = await db();
    if (!d) return [];
    const os = d.transaction(STORE, "readonly").objectStore(STORE);
    const [keys, values] = await Promise.all([done(os.getAllKeys()), done(os.getAll())]);
    return keys.map((k, i) => [String(k), values[i] as string]);
  },
});

export const fileOf = (hash: string): string | undefined => held.get(hash);

export function keepFile(hash: string, data: string): void {
  if (!data || held.get(hash) === data) return;
  held.set(hash, data);
  void store()
    .set(hash, data)
    .catch(() => undefined);
}

/** Reads what this browser has kept. Safe to call more than once. */
export function loadFiles(): Promise<void> {
  loading ??= store()
    .entries()
    .then((all) => {
      for (const [k, v] of all) if (!held.has(k)) held.set(k, v);
    })
    .catch(() => undefined);
  return loading;
}

/** The files a set of components' bodies need, each once. */
export function stepFiles(defs: Iterable<ComponentDef>): string[] {
  const out = new Set<string>();
  for (const d of defs) for (const p of d.packages) if (p.model?.source.kind === "step") out.add(p.model.source.blob);
  return [...out];
}

/** The model's blobs with every file its components need that this browser holds and the model does not. */
export function withPartFiles(blobs: Record<string, string> | undefined, defs: Iterable<ComponentDef>): Record<string, string> | undefined {
  const need = stepFiles(defs).filter((h) => !blobs?.[h] && held.has(h));
  return need.length ? { ...blobs, ...Object.fromEntries(need.map((h) => [h, held.get(h)!])) } : blobs;
}

/** For tests: forget everything held in memory. */
export function forgetFiles(): void {
  held.clear();
  loading = null;
}
