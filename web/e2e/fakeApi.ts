import type { BrowserContext, Route } from "@playwright/test";

/**
 * A stand-in for BetterCad's server (#87, #88) inside Playwright: the preview build has no API, so the account and
 * model routes are answered here from memory. It follows server/bettercad/models.py closely enough for the pages:
 * sessions by cookie, CSRF on writes, versions with If-Match, the bin, blobs and share links.
 */
interface Version {
  number: number;
  bcad: string;
  note: string | null;
  created: string;
}
interface Model {
  id: string;
  user: number;
  name: string;
  versions: Version[];
  created: string;
  modified: string;
  deleted_at: string | null;
  share?: string;
}

export interface FakeServer {
  models: Map<string, Model>;
  blobs: Map<string, Buffer>;
  /** Signs a new account in on this context. */
  signIn(context: BrowserContext, name?: string): Promise<void>;
}

const now = () => new Date().toISOString().replace("T", " ").replace("Z", "");

export async function fakeApi(context: BrowserContext): Promise<FakeServer> {
  const users: { id: number; email: string; name: string; password: string; theme: string | null }[] = [];
  const sessions = new Map<string, { user: number; csrf: string }>();
  const models = new Map<string, Model>();
  const blobs = new Map<string, Buffer>();
  let ids = 0;

  const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers });
  const fail = (route: Route, status: number, detail: unknown) => json(route, status, { detail });
  const me = (u: (typeof users)[number], csrf: string) => ({ id: u.id, email: u.email, name: u.name, theme: u.theme, csrf });
  const start = (route: Route, u: (typeof users)[number], status = 200) => {
    const token = `s${++ids}`;
    const csrf = `c${ids}`;
    sessions.set(token, { user: u.id, csrf });
    return json(route, status, me(u, csrf), { "Set-Cookie": `bc_session=${token}; Path=/; HttpOnly; SameSite=Lax` });
  };
  const summary = (m: Model) => ({
    id: m.id,
    name: m.name,
    version: m.versions.at(-1)!.number,
    created: m.created,
    modified: m.modified,
    deleted_at: m.deleted_at,
    thumbnail: m.versions.at(-1)!.bcad.includes('"thumbnail"') ? `/api/models/${m.id}/thumbnail?v=${m.versions.at(-1)!.number}` : null,
  });
  const addVersion = (m: Model, bcad: string, note: string | null) => {
    m.versions.push({ number: (m.versions.at(-1)?.number ?? 0) + 1, bcad, note, created: now() });
    m.modified = now();
  };

  await context.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/api\//, "");
    const method = req.method();
    const cookie = /bc_session=([^;]+)/.exec((await req.allHeaders())["cookie"] ?? "")?.[1];
    const session = cookie ? sessions.get(cookie) : undefined;
    const user = session ? users.find((u) => u.id === session.user) : undefined;
    const body = () => (req.postData() ? JSON.parse(req.postData()!) : {});

    if (path === "auth/signup" && method === "POST") {
      const b = body();
      if (users.some((u) => u.email.toLowerCase() === b.email.toLowerCase()))
        return fail(route, 409, "There's already an account with that email. Sign in instead.");
      const u = { id: users.length + 1, email: b.email, name: b.name, password: b.password, theme: null };
      users.push(u);
      return start(route, u, 201);
    }
    if (path === "auth/signin" && method === "POST") {
      const b = body();
      const u = users.find((x) => x.email.toLowerCase() === b.email.toLowerCase() && x.password === b.password);
      return u ? start(route, u) : fail(route, 401, "That email and password don't match.");
    }
    if (path.startsWith("shared/") && method === "GET") {
      const [, token, what, hash] = path.split("/");
      const m = [...models.values()].find((x) => x.share === token && !x.deleted_at);
      if (!m) return fail(route, 404, "This link isn't active any more.");
      if (what === "blobs") return route.fulfill({ status: 200, body: blobs.get(`${m.user}/${hash}`) ?? Buffer.from("") });
      const owner = users.find((u) => u.id === m.user)!;
      const v = m.versions.at(-1)!;
      return json(route, 200, { name: m.name, owner: owner.name, version: v.number, modified: m.modified, bcad: v.bcad, thumbnail: null });
    }
    if (!user || !session) return fail(route, 401, "Sign in to do that.");
    if (method !== "GET" && method !== "HEAD" && (await req.headerValue("x-csrf-token")) !== session.csrf) {
      return fail(route, 403, "This page is out of date. Reload it and try again.");
    }

    if (path === "auth/me") {
      if (method === "GET") return json(route, 200, me(user, session.csrf));
      if (method === "PATCH") {
        Object.assign(user, body());
        return json(route, 200, me(user, session.csrf));
      }
    }
    if (path === "auth/signout" && method === "POST") {
      sessions.delete(cookie!);
      return json(route, 200, { ok: true }, { "Set-Cookie": "bc_session=; Path=/; Max-Age=0" });
    }
    if (path === "me/usage") {
      const mine = [...models.values()].filter((m) => m.user === user.id);
      const bytes = mine.reduce((n, m) => n + m.versions.reduce((k, v) => k + v.bcad.length, 0), 0);
      return json(route, 200, { models: mine.filter((m) => !m.deleted_at).length, bytes, quota: 500 * 1024 * 1024 });
    }
    if (path.startsWith("blobs/")) {
      const key = `${user.id}/${path.slice(6)}`;
      if (method === "HEAD") return route.fulfill({ status: blobs.has(key) ? 200 : 404 });
      if (method === "PUT") {
        blobs.set(key, req.postDataBuffer() ?? Buffer.from(""));
        return json(route, 200, { hash: path.slice(6), stored: true });
      }
      const b = blobs.get(key);
      return b ? route.fulfill({ status: 200, body: b }) : fail(route, 404, "That file isn't here.");
    }
    if (path === "models" && method === "POST") {
      const b = body();
      const m: Model = { id: `m${++ids}`, user: user.id, name: b.name, versions: [], created: now(), modified: now(), deleted_at: null };
      addVersion(m, b.bcad, b.note ?? null);
      models.set(m.id, m);
      return json(route, 201, summary(m));
    }
    if (path === "models" && method === "GET") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const bin = url.searchParams.get("bin") === "true";
      const list = [...models.values()]
        .filter((m) => m.user === user.id && !!m.deleted_at === bin && m.name.toLowerCase().includes(q))
        .sort((a, b) => (url.searchParams.get("sort") === "name" ? a.name.localeCompare(b.name) : b.modified.localeCompare(a.modified)));
      return json(route, 200, { models: list.map(summary), total: list.length });
    }
    const [, id, sub, n, action] = path.split("/");
    const m = id ? models.get(id) : undefined;
    if (!m || m.user !== user.id) return fail(route, 404, "That model isn't here. It may have been deleted.");
    const latest = m.versions.at(-1)!;
    if (!sub) {
      if (method === "GET") return json(route, 200, { ...summary(m), bcad: latest.bcad, note: latest.note });
      if (method === "PUT") {
        const match = await req.headerValue("if-match");
        if (match && match !== String(latest.number)) return fail(route, 409, { message: "This model changed in another tab.", version: latest.number });
        const b = body();
        addVersion(m, b.bcad, b.note ?? null);
        if (b.name) m.name = b.name;
        return json(route, 200, { version: m.versions.at(-1)!.number });
      }
      if (method === "PATCH") {
        m.name = body().name;
        m.modified = now();
        return json(route, 200, summary(m));
      }
      if (method === "DELETE") {
        if (url.searchParams.get("forever") === "true") models.delete(m.id);
        else m.deleted_at = now();
        return json(route, 200, { ok: true });
      }
    }
    if (sub === "duplicate") {
      const copy: Model = { ...m, id: `m${++ids}`, name: `${m.name} copy`, versions: [{ ...latest, number: 1 }], created: now(), modified: now() };
      models.set(copy.id, copy);
      return json(route, 201, summary(copy));
    }
    if (sub === "restore") {
      m.deleted_at = null;
      return json(route, 200, summary(m));
    }
    if (sub === "thumbnail") return fail(route, 404, "There's no picture for that model.");
    if (sub === "share") {
      if (method === "DELETE") delete m.share;
      else m.share ??= `t${String(++ids).padStart(21, "0")}`;
      return json(route, 200, method === "DELETE" ? { ok: true } : { token: m.share });
    }
    if (sub === "versions") {
      const info = (v: Version) => ({ number: v.number, size: v.bcad.length, created: v.created, note: v.note, thumbnail: null });
      if (!n) return json(route, 200, { versions: [...m.versions].reverse().map(info) });
      const v = m.versions.find((x) => x.number === Number(n));
      if (!v) return fail(route, 404, "That version isn't here any more.");
      if (action === "restore") {
        addVersion(m, v.bcad, `Restored version ${v.number}`);
        return json(route, 200, { version: m.versions.at(-1)!.number });
      }
      if (method === "PATCH") {
        v.note = body().note || null;
        return json(route, 200, info(v));
      }
      return json(route, 200, { ...summary(m), bcad: v.bcad, ...info(v) });
    }
    return fail(route, 404, "Not found");
  });

  return {
    models,
    blobs,
    async signIn(ctx, name = "Kev") {
      const u = { id: users.length + 1, email: `${name.toLowerCase()}${users.length}@example.com`, name, password: "password1", theme: null };
      users.push(u);
      const token = `s${++ids}`;
      sessions.set(token, { user: u.id, csrf: `c${ids}` });
      await ctx.addCookies([{ name: "bc_session", value: token, url: "http://127.0.0.1:4173" }]);
    },
  };
}
