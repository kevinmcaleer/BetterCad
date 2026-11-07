import { idbKV, type KV } from "../files/idb";
import { ApiError, type Api, type ModelFull, type ModelSummary } from "./api";

/**
 * Working offline with an account (#96). Saves that can't reach the server wait here, the newest per model, and go
 * when the browser is back online. The library's last list and the last 10 opened models are kept so they still
 * show, read from the cache, while offline.
 */
export interface Queued {
  modelId: string;
  name: string;
  bcad: string;
  note?: string;
  /** The version this save follows, for the conflict check. */
  version: number;
  at: number;
}

export interface FlushResult {
  saved: { modelId: string; version: number }[];
  conflicts: Queued[];
}

const KEEP_MODELS = 10;

export function createOffline(queue: KV<Queued> = idbKV<Queued>("cloudQueue"), cache: KV<unknown> = idbKV<unknown>("cloudCache")) {
  let flushing: Promise<FlushResult> | null = null;
  return {
    queue: (q: Queued) => queue.set(q.modelId, q),
    queued: async () => (await queue.entries()).map(([, v]) => v).sort((a, b) => a.at - b.at),
    drop: (modelId: string) => queue.del(modelId),

    /** Sends what is waiting, oldest first. A conflict stays out of the queue and comes back for the caller to ask. */
    flush(api: Api): Promise<FlushResult> {
      flushing ??= (async () => {
        const out: FlushResult = { saved: [], conflicts: [] };
        try {
          for (const [, q] of await queue.entries()) {
            try {
              const r = await api.save(q.modelId, q.bcad, { note: q.note, name: q.name, ifMatch: q.version });
              out.saved.push({ modelId: q.modelId, version: r.version });
              await queue.del(q.modelId);
            } catch (e) {
              if (e instanceof ApiError && e.status === 0) break;
              await queue.del(q.modelId);
              if (e instanceof ApiError && e.status === 409) out.conflicts.push(q);
            }
          }
          return out;
        } finally {
          flushing = null;
        }
      })();
      return flushing;
    },

    rememberList: (models: ModelSummary[]) => cache.set("list", models).catch(() => undefined),
    lastList: async () => ((await cache.get("list").catch(() => undefined)) as ModelSummary[] | undefined) ?? null,
    async rememberModel(m: ModelFull) {
      try {
        await cache.set(`model:${m.id}`, { ...m, at: Date.now() });
        const models = (await cache.entries()).filter(([k]) => k.startsWith("model:")) as [string, ModelFull & { at: number }][];
        models.sort((a, b) => b[1].at - a[1].at);
        for (const [k] of models.slice(KEEP_MODELS)) await cache.del(k);
      } catch {
        // The cache is a convenience; the server has the model.
      }
    },
    lastModel: async (id: string) => ((await cache.get(`model:${id}`).catch(() => undefined)) as ModelFull | undefined) ?? null,
  };
}

export type Offline = ReturnType<typeof createOffline>;

let shared: Offline | null = null;
/** One per page, so the editor and the library share the queue. */
export const offline = () => (shared ??= createOffline());
