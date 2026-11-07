import { idbKV, type KV } from "./idb";

/**
 * Autosave (#84): a closed tab loses nothing. Changes are written to IndexedDB 3 seconds after they stop (and at
 * once when the page is hidden or saved); on the next visit a newer autosave than the saved file can be recovered.
 */
export interface AutosaveRecord {
  /** The model's id (kept in its .bcad header). */
  id: string;
  name: string;
  /** The .bcad text, with the whole timeline whatever the marker shows. */
  json: string;
  modified: number;
  /** When the model was last saved to a file, or null if it never was. */
  savedAt: number | null;
  /** The saved file's name, if it has one. */
  source: string | null;
}

export interface Discarded extends AutosaveRecord {
  discardedAt: number;
}

export interface AutosaveOptions {
  kv?: KV<AutosaveRecord>;
  bin?: KV<Discarded>;
  delay?: number;
  /** How many models' autosaves to keep. */
  keep?: number;
  now?: () => number;
  /** Runs work when the browser is idle, so serialising never costs a frame. */
  idle?: (fn: () => void) => void;
  onWrite?: (r: AutosaveRecord) => void;
}

export const AUTOSAVE_DELAY = 3000;
const KEEP = 20;
const BIN_TTL = 24 * 60 * 60 * 1000;

type Pending = () => Omit<AutosaveRecord, "modified">;

const idleCallback = (fn: () => void) => {
  const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 1000 });
  else setTimeout(fn, 0);
};

export function createAutosave(o: AutosaveOptions = {}) {
  const kv = o.kv ?? idbKV<AutosaveRecord>("autosave");
  const bin = o.bin ?? idbKV<Discarded>("discarded");
  const delay = o.delay ?? AUTOSAVE_DELAY;
  const keep = o.keep ?? KEEP;
  const now = o.now ?? Date.now;
  const idle = o.idle ?? idleCallback;
  let pending: Pending | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();

  const write = (make: Pending) => {
    const rec = { ...make(), modified: now() };
    chain = chain
      .then(async () => {
        await kv.set(rec.id, rec);
        await evict();
        o.onWrite?.(rec);
      })
      .catch(() => undefined);
    return chain;
  };

  const evict = async () => {
    const all = (await kv.entries()).map(([, r]) => r).sort((a, b) => b.modified - a.modified);
    for (const r of all.slice(keep)) await kv.del(r.id);
    const t = now();
    for (const [k, r] of await bin.entries()) if (t - r.discardedAt > BIN_TTL) await bin.del(k);
  };

  return {
    /** Notes a change; it is written once changes stop for the delay. The record is made when it is written. */
    schedule(make: Pending) {
      pending = make;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        const p = pending;
        pending = null;
        if (p) idle(() => void write(p));
      }, delay);
    },
    /** Writes a waiting change now (the page is going away, or a save is about to happen). */
    flush(): Promise<void> {
      clearTimeout(timer);
      timer = undefined;
      const p = pending;
      pending = null;
      return p ? write(p) : chain;
    },
    /** Forgets a waiting change (a model was opened over it). */
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
    async list(): Promise<AutosaveRecord[]> {
      await chain;
      return (await kv.entries()).map(([, r]) => r).sort((a, b) => b.modified - a.modified);
    },
    async get(id: string) {
      await chain;
      return kv.get(id);
    },
    /** Records that the model was saved to a file, so its autosave is no longer newer. */
    async markSaved(id: string, at = now(), source?: string) {
      await chain;
      const r = await kv.get(id);
      if (r) await kv.set(id, { ...r, savedAt: Math.max(at, r.modified), source: source ?? r.source });
    },
    /** Drops an autosave without asking; it is kept a day in a bin in case. */
    async discard(id: string) {
      await chain;
      const r = await kv.get(id);
      if (!r) return;
      await bin.set(id, { ...r, discardedAt: now() });
      await kv.del(id);
    },
  };
}

export type Autosave = ReturnType<typeof createAutosave>;

/** Autosaves newer than their saved file (or never saved), other than the model that is open, newest first. */
export function recoverable(records: AutosaveRecord[], openId: string | null): AutosaveRecord[] {
  return records.filter((r) => r.id !== openId && (r.savedAt === null || r.modified > r.savedAt)).sort((a, b) => b.modified - a.modified);
}

/** "2 minutes ago", for the Recover banner. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? "1 minute ago" : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? "1 hour ago" : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
