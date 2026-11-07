/**
 * A tiny key-value store over IndexedDB: one database ("bettercad"), a store per use (recent files, autosave).
 * File handles can only be kept here, not in localStorage. Tests use `memoryKV`.
 */
export interface KV<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  entries(): Promise<[string, T][]>;
}

const DB = "bettercad";
const STORES = ["recent", "autosave", "discarded"] as const;
export type StoreName = (typeof STORES)[number];

let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }).catch((e) => {
    opening = null;
    throw e;
  });
  return opening;
}

function req<R>(r: IDBRequest<R>): Promise<R> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** The IndexedDB store, or an in-memory one where IndexedDB is missing (some private windows). */
export function idbKV<T>(store: StoreName): KV<T> {
  if (typeof indexedDB === "undefined") return memoryKV<T>();
  const tx = async (mode: IDBTransactionMode) => (await db()).transaction(store, mode).objectStore(store);
  return {
    get: async (k) => req((await tx("readonly")).get(k)) as Promise<T | undefined>,
    set: async (k, v) => void (await req((await tx("readwrite")).put(v, k))),
    del: async (k) => void (await req((await tx("readwrite")).delete(k))),
    entries: async () => {
      const s = await tx("readonly");
      const [keys, values] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]);
      return keys.map((k, i) => [String(k), values[i] as T]);
    },
  };
}

export function memoryKV<T>(): KV<T> {
  const m = new Map<string, T>();
  return {
    get: async (k) => m.get(k),
    set: async (k, v) => void m.set(k, v),
    del: async (k) => void m.delete(k),
    entries: async () => [...m],
  };
}
