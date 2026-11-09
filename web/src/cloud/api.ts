/**
 * The server's API (#87, #88): accounts, saved models, versions, share links and import blobs. Everything here is
 * optional: the editor works fully without a server, and every call fails with an ApiError the caller can show.
 */

/** A signed-in person: their kevsrobots.com account (#88). `name` is the username. */
export interface Account {
  id: number;
  username: string;
  name: string;
  email: string | null;
  theme: string | null;
  csrf: string;
}

/** Where to sign in, make an account or manage it: pages on kevsrobots.com that send you back here. */
export interface AuthLinks {
  signin_url: string;
  signup_url: string;
  account_url: string;
  /** Set when kevsrobots.com can't be asked who you are just now. */
  problem?: string | null;
}

interface Session extends AuthLinks {
  user: { id: number; username: string; email: string | null } | null;
  csrf_token: string;
}

export interface ModelSummary {
  id: string;
  name: string;
  version: number;
  created: string;
  modified: string;
  deleted_at: string | null;
  /** A path under the API, or null when the model has no picture. */
  thumbnail: string | null;
  /** Bytes the model takes from your quota, every saved version together. Only in the models list. */
  size?: number;
  /** How many versions are saved. Only in the models list. */
  versions?: number;
}

export interface ModelFull extends ModelSummary {
  bcad: string;
  note: string | null;
}

export interface VersionInfo {
  number: number;
  size: number;
  created: string;
  note: string | null;
  thumbnail: string | null;
}

export interface Shared {
  name: string;
  owner: string;
  version: number;
  modified: string;
  bcad: string;
  thumbnail: string | null;
}

export interface Usage {
  models: number;
  bytes: number;
  quota: number;
}

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    message: string,
    readonly status: number,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

export const OFFLINE = "You're offline, or BetterCad's server can't be reached.";

/** Server times are UTC without a zone ("2026-11-07 09:12:03.120"). */
export const serverTime = (t: string) => Date.parse(t.replace(" ", "T") + (t.endsWith("Z") ? "" : "Z"));

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function createApi(base = "api/", f: Fetch = (i, o) => fetch(i, o)) {
  let csrf = "";

  async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const h: Record<string, string> = { ...headers };
    if (method !== "GET" && method !== "HEAD") h["X-CSRF-Token"] = csrf;
    let payload: BodyInit | undefined;
    if (body instanceof Blob || body instanceof ArrayBuffer || body instanceof Uint8Array) payload = body as BodyInit;
    else if (body !== undefined) {
      h["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    let r: Response;
    try {
      r = await f(base + path, { method, headers: h, body: payload, credentials: "same-origin" });
    } catch {
      throw new ApiError(OFFLINE, 0);
    }
    if (method === "HEAD") return r.ok as unknown as T;
    const type = r.headers.get("content-type") ?? "";
    const data: unknown = type.includes("json") ? await r.json().catch(() => null) : null;
    // A static host answers with the app's HTML, and a proxy with nothing behind it with a bare 5xx: no server.
    if (!type.includes("json") && r.status !== 413) throw new ApiError(OFFLINE, 0);
    if (!r.ok) {
      const detail = (data as { detail?: unknown } | null)?.detail;
      const message =
        typeof detail === "string"
          ? detail
          : typeof (detail as { message?: string } | undefined)?.message === "string"
            ? (detail as { message: string }).message
            : r.status === 413
              ? "That's too big to save."
              : r.status >= 500
                ? OFFLINE
                : "That didn't work.";
      throw new ApiError(message, r.status, detail);
    }
    return data as T;
  }

  const remember = (a: Account) => {
    csrf = a.csrf;
    return a;
  };
  const session = async (next?: string) => {
    const s = await call<Session>("GET", `auth/session${next ? `?next=${encodeURIComponent(next)}` : ""}`);
    csrf = s.csrf_token;
    return s;
  };
  const m = (id: string) => `models/${encodeURIComponent(id)}`;

  return {
    /** The signed-in account, or null when signed out. Throws ApiError(0) when there is no server. */
    async me(): Promise<Account | null> {
      try {
        const s = await session();
        if (s.problem) throw new ApiError(s.problem, 503);
        // The account adds what only BetterCad keeps (the theme).
        return s.user ? remember(await call<Account>("GET", "account")) : null;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        // A static host (GitHub Pages) answers with HTML or a 404: no accounts there.
        if (e instanceof ApiError && e.status === 404) throw new ApiError(OFFLINE, 0);
        throw e;
      }
    },
    /** kevsrobots.com's sign-in pages, set to send you back to `next` (a hash route) afterwards. */
    links: async (next = "#/library"): Promise<AuthLinks> => {
      const { signin_url, signup_url, account_url, problem } = await session(next);
      return { signin_url, signup_url, account_url, problem: problem ?? null };
    },
    /** Signs out of kevsrobots.com: the cookie is shared, so every kevsrobots app signs out. */
    async signOut() {
      await call<Session>("POST", "auth/logout");
      csrf = "";
      return { ok: true as const };
    },
    updateMe: async (change: { theme?: string }) => remember(await call<Account>("PATCH", "account", change)),
    /** Deletes your models, files and settings here. Your kevsrobots.com account stays. */
    deleteMe: (confirm_username: string) => call<{ ok: true }>("DELETE", "account", { confirm_username }),

    list: (o: { q?: string; sort?: "modified" | "name"; bin?: boolean; limit?: number; offset?: number } = {}) => {
      const p = new URLSearchParams();
      if (o.q) p.set("q", o.q);
      if (o.sort) p.set("sort", o.sort);
      if (o.bin) p.set("bin", "true");
      p.set("limit", String(o.limit ?? 200));
      if (o.offset) p.set("offset", String(o.offset));
      return call<{ models: ModelSummary[]; total: number }>("GET", `models?${p}`);
    },
    create: (name: string, bcad: string, note?: string) => call<ModelSummary>("POST", "models", { name, bcad, note }),
    get: (id: string) => call<ModelFull>("GET", m(id)),
    /** Saves a new version. `ifMatch` is the version this save follows; a 409 means another tab saved first. */
    save: (id: string, bcad: string, o: { note?: string; name?: string; ifMatch?: number } = {}) =>
      call<{ version: number }>("PUT", m(id), { bcad, note: o.note, name: o.name }, o.ifMatch ? { "If-Match": String(o.ifMatch) } : {}),
    /** Replaces a version's picture with a rendered one (a PNG, JPEG or WebP data URL). */
    setThumbnail: (id: string, version: number, thumbnail: string) => call<ModelSummary>("PUT", `${m(id)}/versions/${version}/thumbnail`, { thumbnail }),
    rename: (id: string, name: string) => call<ModelSummary>("PATCH", m(id), { name }),
    duplicate: (id: string) => call<ModelSummary>("POST", `${m(id)}/duplicate`),
    remove: (id: string, forever = false) => call<{ ok: true }>("DELETE", `${m(id)}${forever ? "?forever=true" : ""}`),
    undelete: (id: string) => call<ModelSummary>("POST", `${m(id)}/restore`),
    versions: (id: string) => call<{ versions: VersionInfo[] }>("GET", `${m(id)}/versions`),
    version: (id: string, n: number) => call<ModelFull & VersionInfo>("GET", `${m(id)}/versions/${n}`),
    noteVersion: (id: string, n: number, note: string) => call<VersionInfo>("PATCH", `${m(id)}/versions/${n}`, { note }),
    restoreVersion: (id: string, n: number) => call<{ version: number }>("POST", `${m(id)}/versions/${n}/restore`),
    share: (id: string) => call<{ token: string }>("POST", `${m(id)}/share`),
    unshare: (id: string) => call<{ ok: true }>("DELETE", `${m(id)}/share`),
    shared: (token: string) => call<Shared>("GET", `shared/${encodeURIComponent(token)}`),
    hasBlob: (hash: string) => call<boolean>("HEAD", `blobs/${hash}`),
    putBlob: (hash: string, bytes: Uint8Array, mime = "application/octet-stream") =>
      call<{ hash: string; stored: boolean }>("PUT", `blobs/${hash}`, new Blob([bytes as BlobPart], { type: mime })),
    async getBlob(hash: string, token?: string): Promise<Uint8Array> {
      let r: Response;
      try {
        r = await f(base + (token ? `shared/${encodeURIComponent(token)}/blobs/${hash}` : `blobs/${hash}`), { credentials: "same-origin" });
      } catch {
        throw new ApiError(OFFLINE, 0);
      }
      if (!r.ok) throw new ApiError("A file this model imports is missing.", r.status);
      return new Uint8Array(await r.arrayBuffer());
    },
    usage: () => call<Usage>("GET", "me/usage"),
    /** Printer profiles (#180), each the editor's own JSON. */
    printers: () => call<{ printers: (Record<string, unknown> & { id: string; name: string; modified: string })[] }>("GET", "printers"),
    savePrinter: (id: string, name: string, data: Record<string, unknown>) =>
      call<Record<string, unknown> & { id: string; modified: string }>("PUT", `printers/${encodeURIComponent(id)}`, { name, data }),
    deletePrinter: (id: string) => call<{ ok: true }>("DELETE", `printers/${encodeURIComponent(id)}`),
    /** An API path (thumbnails) as a URL the page can load. */
    url: (path: string) => base + path.replace(/^\/?api\//, ""),
  };
}

export type Api = ReturnType<typeof createApi>;
