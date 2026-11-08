/**
 * The server's API (#87, #88): accounts, saved models, versions, share links and import blobs. Everything here is
 * optional: the editor works fully without a server, and every call fails with an ApiError the caller can show.
 */

/** A signed-in person. Sign-in is powertools-auth (#88), shared with Kev's other apps; `name` is the username. */
export interface Account {
  id: number;
  username: string;
  name: string;
  email: string | null;
  theme: string | null;
  csrf: string;
}

/** What `auth/session` says about this server's sign-in. */
export interface AuthInfo {
  registration_open: boolean;
  /** True when the server can email a reset link. */
  password_reset: boolean;
}

interface Session {
  user: { id: number; username: string; email: string | null } | null;
  csrf_token: string;
  registration_open?: boolean;
  password_reset?: boolean;
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
  let info: AuthInfo = { registration_open: true, password_reset: false };
  /** The sign-in forms need a CSRF token before anyone is signed in; the session call hands one out. */
  const session = async () => {
    const s = await call<Session>("GET", "auth/session");
    csrf = s.csrf_token;
    info = { registration_open: s.registration_open ?? true, password_reset: s.password_reset ?? false };
    return s;
  };
  const ensureCsrf = async () => {
    if (!csrf) await session();
  };
  /** After signing in, the account adds what only BetterCad keeps (the theme). */
  const signedIn = async (s: Session) => {
    csrf = s.csrf_token;
    return remember(await call<Account>("GET", "account"));
  };
  const m = (id: string) => `models/${encodeURIComponent(id)}`;

  return {
    /** The signed-in account, or null when signed out. Throws ApiError(0) when there is no server. */
    async me(): Promise<Account | null> {
      try {
        const s = await session();
        return s.user ? await signedIn(s) : null;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        // A static host (GitHub Pages) answers with HTML or a 404: no accounts there.
        if (e instanceof ApiError && e.status === 404) throw new ApiError(OFFLINE, 0);
        throw e;
      }
    },
    /** Whether sign-up is open and email resets work, as of the last `me()`. */
    info: () => info,
    /** `login` is a username or an email address. */
    async signIn(login: string, password: string, remember = true) {
      await ensureCsrf();
      return signedIn(await call<Session>("POST", "auth/login", { username: login, password, remember }));
    },
    async signUp(username: string, email: string, password: string) {
      await ensureCsrf();
      return signedIn(await call<Session>("POST", "auth/register", { username, email, password }));
    },
    async signOut() {
      const s = await call<Session>("POST", "auth/logout");
      csrf = s.csrf_token;
      return { ok: true as const };
    },
    updateMe: async (change: { theme?: string }) => remember(await call<Account>("PATCH", "account", change)),
    async changePassword(current_password: string, new_password: string) {
      return signedIn(await call<Session>("POST", "auth/password", { current_password, new_password }));
    },
    async changeEmail(email: string, current_password: string) {
      await call<Session>("POST", "auth/email", { email, current_password });
      return remember(await call<Account>("GET", "account"));
    },
    async forgotPassword(login: string) {
      await ensureCsrf();
      return call<{ ok: true }>("POST", "auth/forgot-password", { login });
    },
    async resetPassword(token: string, password: string) {
      await ensureCsrf();
      return signedIn(await call<Session>("POST", "auth/reset-password", { token, password }));
    },
    /** Deletes your models and settings here; with the shared login, the account stays for Kev's other apps. */
    async deleteMe(confirm_username: string) {
      const r = await call<{ ok: true; csrf_token: string }>("DELETE", "account", { confirm_username });
      csrf = r.csrf_token;
      return r;
    },

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
