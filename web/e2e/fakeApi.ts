import type { BrowserContext, Route } from "@playwright/test";

/**
 * A stand-in for BetterCad's server (#87, #88) inside Playwright: the preview build has no API, so the account and
 * model routes are answered here from memory. It follows server/bettercad/models.py closely enough for the pages:
 * sessions by cookie, CSRF on writes, versions with If-Match, the bin, blobs and share links. Sign-in follows
 * server/bettercad/auth.py: the kevsrobots.com cookie (`access_token`), auth/session with kevsrobots.com's links,
 * logout and account. A fake chatter.kevsrobots.com signs "Kev" in and sends the browser back.
 */
interface Version {
  number: number;
  bcad: string;
  note: string | null;
  created: string;
  /** A rendered picture sent after the save, in place of the one in the .bcad. */
  thumbnail?: string;
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
  folder_id?: string | null;
  project_id?: string | null;
}
/** Folders and projects (#273, #274), just enough for the library's pages. */
interface Folder {
  id: string;
  user: number;
  name: string;
  parent_id: string | null;
  project_id: string | null;
}
interface Project {
  id: string;
  user: number;
  name: string;
  readme: string;
}

export interface FakeServer {
  models: Map<string, Model>;
  folders: Map<string, Folder>;
  blobs: Map<string, Buffer>;
  /** While true every request fails as if the network were gone. */
  down: boolean;
  /** Signs a new account in on this context. */
  signIn(context: BrowserContext, name?: string): Promise<void>;
}

const BASE = "http://127.0.0.1:4173";
const now = () => new Date().toISOString().replace("T", " ").replace("Z", "");

export async function fakeApi(context: BrowserContext): Promise<FakeServer> {
  const users: { id: number; email: string; username: string; theme: string | null }[] = [];
  const sessions = new Map<string, { user: number; csrf: string }>();
  const models = new Map<string, Model>();
  const blobs = new Map<string, Buffer>();
  const folders = new Map<string, Folder>();
  const projects = new Map<string, Project>();
  let ids = 0;

  const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers });
  const fail = (route: Route, status: number, detail: unknown) => json(route, status, { detail });
  const me = (u: (typeof users)[number], csrf: string) => ({ id: u.id, username: u.username, name: u.username, email: u.email, theme: u.theme, csrf });
  const pub = (u: (typeof users)[number]) => ({ id: u.id, username: u.username, email: u.email });
  const CHATTER = "https://chatter.kevsrobots.com";
  const links = (next: string) => {
    const back = encodeURIComponent(`${BASE}/${next}`);
    return { signin_url: `${CHATTER}/login?return_to=${back}`, signup_url: `${CHATTER}/register?return_to=${back}`, account_url: `${CHATTER}/account` };
  };
  const signInAs = async (ctx: BrowserContext, name: string) => {
    let u = users.find((x) => x.username === name);
    if (!u) {
      u = { id: users.length + 1, email: `${name.toLowerCase()}${users.length}@example.com`, username: name, theme: null };
      users.push(u);
    }
    const token = `s${++ids}`;
    sessions.set(token, { user: u.id, csrf: `c${ids}` });
    await ctx.addCookies([{ name: "access_token", value: token, url: BASE, httpOnly: true, sameSite: "Lax" }]);
  };
  // kevsrobots.com's sign-in: signs Kev in and goes back to return_to.
  await context.route(`${CHATTER}/**`, async (route) => {
    const back = new URL(route.request().url()).searchParams.get("return_to") ?? `${BASE}/`;
    await signInAs(context, "Kev");
    return route.fulfill({ status: 302, headers: { Location: back } });
  });
  const summary = (m: Model) => ({
    id: m.id,
    name: m.name,
    version: m.versions.at(-1)!.number,
    created: m.created,
    modified: m.modified,
    deleted_at: m.deleted_at,
    folder_id: m.folder_id ?? null,
    project_id: m.project_id ?? null,
    thumbnail: m.versions.at(-1)!.bcad.includes('"thumbnail"') ? `/api/models/${m.id}/thumbnail?v=${m.versions.at(-1)!.number}` : null,
  });
  const addVersion = (m: Model, bcad: string, note: string | null) => {
    m.versions.push({ number: (m.versions.at(-1)?.number ?? 0) + 1, bcad, note, created: now() });
    m.modified = now();
  };

  const server = { down: false } as FakeServer;
  await context.route("**/api/**", async (route) => {
    if (server.down) return route.abort("internetdisconnected");
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/api\//, "");
    const method = req.method();
    // WebKit intercepts before it adds cookies, so the request may carry none: read the context's jar instead.
    const cookie =
      /access_token=([^;]+)/.exec((await req.allHeaders())["cookie"] ?? "")?.[1] ??
      (await context.cookies(BASE)).find((c) => c.name === "access_token" && c.value)?.value;
    const session = cookie ? sessions.get(cookie) : undefined;
    const user = session ? users.find((u) => u.id === session.user) : undefined;
    const body = () => (req.postData() ? JSON.parse(req.postData()!) : {});

    if (path === "auth/session" && method === "GET") {
      const next = url.searchParams.get("next") ?? "#/library";
      return json(route, 200, { user: user ? pub(user) : null, csrf_token: session?.csrf ?? "", ...links(next) });
    }
    if (path.startsWith("shared/") && method === "GET") {
      const [, token, what, hash] = path.split("/");
      const m = [...models.values()].find((x) => x.share === token && !x.deleted_at);
      if (!m) return fail(route, 404, "This link isn't active any more.");
      if (what === "blobs") return route.fulfill({ status: 200, body: blobs.get(`${m.user}/${hash}`) ?? Buffer.from("") });
      const owner = users.find((u) => u.id === m.user)!;
      const v = m.versions.at(-1)!;
      return json(route, 200, { name: m.name, owner: owner.username, version: v.number, modified: m.modified, bcad: v.bcad, thumbnail: null });
    }
    if (!user || !session) return fail(route, 401, "Sign in to do that.");
    if (method !== "GET" && method !== "HEAD" && (await req.headerValue("x-csrf-token")) !== session.csrf) {
      return fail(route, 403, "This page is out of date. Reload it and try again.");
    }

    if (path === "account") {
      if (method === "GET") return json(route, 200, me(user, session.csrf));
      if (method === "PATCH") {
        user.theme = body().theme ?? user.theme;
        return json(route, 200, me(user, session.csrf));
      }
    }
    if (path === "auth/logout" && method === "POST") {
      sessions.delete(cookie!);
      await context.clearCookies({ name: "access_token" });
      return json(route, 200, { user: null, csrf_token: "" }, { "Set-Cookie": "access_token=; Path=/; Max-Age=0" });
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
    const folderJson = (f: Folder) => ({
      ...f,
      created: now(),
      modified: now(),
      deleted_at: null,
      models: [...models.values()].filter((m) => m.folder_id === f.id && !m.deleted_at).length,
      folders: [...folders.values()].filter((c) => c.parent_id === f.id).length,
    });
    const projectJson = (p: Project) => ({
      ...p,
      cover: null,
      created: now(),
      modified: now(),
      deleted_at: null,
      models: [...models.values()].filter((m) => m.project_id === p.id && !m.deleted_at).length,
    });
    const placeOf = (b: { folder_id?: string | null; project_id?: string | null }) => {
      const f = b.folder_id ? folders.get(b.folder_id) : undefined;
      return f ? { folder_id: f.id, project_id: f.project_id } : { folder_id: null, project_id: b.project_id ?? null };
    };
    if (path === "places" && method === "GET") {
      if (url.searchParams.get("bin") === "true") return json(route, 200, { folders: [], projects: [] });
      const mine = <T extends { user: number }>(xs: Map<string, T>) => [...xs.values()].filter((x) => x.user === user.id);
      return json(route, 200, { folders: mine(folders).map(folderJson), projects: mine(projects).map(projectJson) });
    }
    if (path === "folders" && method === "POST") {
      const b = body();
      const parent = b.parent_id ? folders.get(b.parent_id) : undefined;
      const f: Folder = {
        id: `f${++ids}`,
        user: user.id,
        name: b.name,
        parent_id: parent?.id ?? null,
        project_id: parent ? parent.project_id : (b.project_id ?? null),
      };
      folders.set(f.id, f);
      return json(route, 201, folderJson(f));
    }
    if (path === "projects" && method === "POST") {
      const b = body();
      const p: Project = { id: `p${++ids}`, user: user.id, name: b.name, readme: b.readme ?? "" };
      projects.set(p.id, p);
      return json(route, 201, projectJson(p));
    }
    if (path.startsWith("projects/") && method === "GET") {
      const p = projects.get(path.split("/")[1]!);
      return p ? json(route, 200, projectJson(p)) : fail(route, 404, "That project isn't here. It may have been deleted.");
    }
    if (path === "models" && method === "POST") {
      const b = body();
      const m: Model = { id: `m${++ids}`, user: user.id, name: b.name, versions: [], created: now(), modified: now(), deleted_at: null, ...placeOf(b) };
      addVersion(m, b.bcad, b.note ?? null);
      models.set(m.id, m);
      return json(route, 201, summary(m));
    }
    if (path === "models" && method === "GET") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const bin = url.searchParams.get("bin") === "true";
      const [folder, project, top] = ["folder", "project", "top"].map((k) => url.searchParams.get(k));
      const here = (m: Model) =>
        folder ? m.folder_id === folder : project ? m.project_id === project && !m.folder_id : top ? !m.folder_id && !m.project_id : true;
      const list = [...models.values()]
        .filter((m) => m.user === user.id && !!m.deleted_at === bin && m.name.toLowerCase().includes(q) && here(m))
        .sort((a, b) => (url.searchParams.get("sort") === "name" ? a.name.localeCompare(b.name) : b.modified.localeCompare(a.modified)));
      const sized = (m: Model) => ({ ...summary(m), size: m.versions.reduce((n, v) => n + v.bcad.length, 0), versions: m.versions.length });
      return json(route, 200, { models: list.map(sized), total: list.length });
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
    if (sub === "move" && method === "POST") {
      Object.assign(m, placeOf(body()));
      return json(route, 200, summary(m));
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
    if (sub === "thumbnail") {
      const thumb = /^data:(image\/\w+);base64,(.+)$/.exec(latest.thumbnail ?? JSON.parse(latest.bcad).thumbnail ?? "");
      if (!thumb) return fail(route, 404, "There's no picture for that model.");
      return route.fulfill({ status: 200, contentType: thumb[1], body: Buffer.from(thumb[2]!, "base64") });
    }
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
      if (action === "thumbnail" && method === "PUT") {
        v.thumbnail = body().thumbnail;
        return json(route, 200, summary(m));
      }
      if (method === "PATCH") {
        v.note = body().note || null;
        return json(route, 200, info(v));
      }
      return json(route, 200, { ...summary(m), bcad: v.bcad, ...info(v) });
    }
    return fail(route, 404, "Not found");
  });

  return Object.assign(server, {
    models,
    folders,
    blobs,
    async signIn(ctx: BrowserContext, name = "Kev") {
      await signInAs(ctx, name);
    },
  });
}
