import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Button, Icon } from "@bettercad/ui";
import { ApiError, serverTime, type AdminModel, type AdminProject, type AdminUser, type AdminVisit } from "../cloud/api";
import { useAccount } from "../cloud/account";
import { go } from "../cloud/route";
import { ago } from "../files/autosave";
import { formatBytes } from "../export/format";
import { Page } from "./Page";

/**
 * The admin console (#/admin): everyone who has signed in to BetterCad, newest activity first, with when they signed
 * up and signed in, and the projects and models each has saved. Only accounts in ADMIN_EMAILS or ADMIN_USERS see it;
 * the server checks on every call.
 */

const AdminParts = lazy(() => import("./AdminParts").then((m) => ({ default: m.AdminParts })));

const when = (t: string | null) => (t ? ago(Date.now() - serverTime(t)) : "never");
/** "Last seen" is a day, not a moment: today reads as today rather than "9 hours ago". */
const day = (d: string | null) => {
  if (!d) return "not recorded";
  const today = new Date().toISOString().slice(0, 10);
  return d === today ? "today" : when(d);
};
/** A moment as the admin's own clock and calendar show it: "24 Nov 2026, 11:47". */
const stamp = (t: string) =>
  new Date(serverTime(t)).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const date = (t: string) => new Date(serverTime(t)).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
/** How long a visit lasted, to the 5 minutes the server records it in. */
const lasted = (v: AdminVisit) => {
  const m = Math.round((serverTime(v.ended) - serverTime(v.started)) / 60000);
  if (m < 5) return "a few minutes";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
};
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function ModelRow({ m, url, project }: { m: AdminModel; url: (path: string) => string; project?: string }) {
  return (
    <li className="bc-admin-model">
      <Thumb src={m.thumbnail} url={url} icon="cube" />
      <span className="bc-admin-model-text">
        <span className="bc-card-name">{m.name}</span>
        <span className="bc-page-note">
          {project ? `In ${project} · ` : ""}Saved {when(m.modified)} · {plural(m.versions, "version")} · {formatBytes(m.size)}
          {m.shared ? " · Shared" : ""}
          {m.deleted_at ? " · In the bin" : ""}
        </span>
      </span>
    </li>
  );
}

function Thumb({ src, url, icon }: { src: string | null; url: (path: string) => string; icon: "cube" | "folder" }) {
  const [pic, setPic] = useState(!!src);
  return (
    <span className="bc-admin-thumb" aria-hidden="true">
      {src && pic ? <img src={url(src)} alt="" width={64} height={40} loading="lazy" onError={() => setPic(false)} /> : <Icon name={icon} size={20} />}
    </span>
  );
}

function ProjectRow({ p, url }: { p: AdminProject; url: (path: string) => string }) {
  return (
    <li className="bc-admin-model">
      <Thumb src={p.thumbnail} url={url} icon="folder" />
      <span className="bc-admin-model-text">
        <span className="bc-card-name">{p.name}</span>
        <span className="bc-page-note">
          {plural(p.models, "model")} · {formatBytes(p.size)} · Changed {when(p.modified)}
          {p.deleted_at ? " · In the bin" : ""}
        </span>
      </span>
    </li>
  );
}

function UserRow({ u, url }: { u: AdminUser; url: (path: string) => string }) {
  const live = u.models.filter((m) => !m.deleted_at).length;
  const binned = u.models.length - live;
  const projects = u.projects.filter((p) => !p.deleted_at).length;
  const names = new Map(u.projects.map((p) => [p.id, p.name]));
  const loose = u.models.filter((m) => !m.project_id || !names.has(m.project_id));
  const lastIn = u.last_active ? when(u.last_active) : day(u.last_seen);
  return (
    <li className="bc-admin-user">
      <details>
        <summary>
          <span className="bc-admin-name">
            {u.username}
            {u.set_aside && <span className="bc-page-note"> (old sign-in, not claimed)</span>}
          </span>
          {u.email && <span className="bc-page-note">{u.email}</span>}
          <span className="bc-page-note">
            {plural(projects, "project")}, {plural(live, "model")}
            {binned ? `, ${binned} in the bin` : ""} · {formatBytes(u.size)} · Joined {date(u.joined)} · Last signed in {lastIn}
            {u.visits_month ? ` · ${plural(u.visits_month, "visit")} in 30 days` : ""}
          </span>
        </summary>
        <div className="bc-admin-detail">
          {u.projects.length > 0 && (
            <section>
              <h3>Projects</h3>
              <ul className="bc-admin-models" aria-label={`${u.username}'s projects`}>
                {u.projects.map((p) => (
                  <ProjectRow key={p.id} p={p} url={url} />
                ))}
              </ul>
            </section>
          )}
          <section>
            <h3>Models</h3>
            {u.models.length ? (
              <ul className="bc-admin-models" aria-label={`${u.username}'s models`}>
                {u.models.map((m) => (
                  <ModelRow key={m.id} m={m} url={url} project={m.project_id ? names.get(m.project_id) : undefined} />
                ))}
              </ul>
            ) : (
              <p className="bc-page-note">No saved models yet.</p>
            )}
            {loose.length > 0 && loose.length < u.models.length && <p className="bc-page-note">{plural(loose.length, "model")} outside any project.</p>}
          </section>
          <section>
            <h3>Sign-ins</h3>
            {u.visits.length ? (
              <ul className="bc-admin-visits" aria-label={`${u.username}'s sign-ins`}>
                {u.visits.map((v) => (
                  <li key={v.started}>
                    {stamp(v.started)} <span className="bc-page-note">for {lasted(v)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="bc-page-note">
                {u.last_seen ? `Last used BetterCad ${day(u.last_seen)}. Sign-in times are recorded from now on.` : "Not recorded yet."}
              </p>
            )}
          </section>
        </div>
      </details>
    </li>
  );
}

export function AdminPage() {
  const { api, account, ready } = useAccount();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!account?.admin) return;
    let live = true;
    api.adminUsers().then(
      (r) => live && setUsers(r.users),
      (e: unknown) => live && setError(e instanceof ApiError ? e.message : "The users couldn't be loaded."),
    );
    return () => {
      live = false;
    };
  }, [api, account]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!users || !t) return users;
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(t) ||
        (u.email ?? "").toLowerCase().includes(t) ||
        u.projects.some((p) => p.name.toLowerCase().includes(t)) ||
        u.models.some((m) => m.name.toLowerCase().includes(t)),
    );
  }, [users, q]);

  const bar = <Button label="Editor" icon="cube" onClick={() => go("#/")} />;
  if (!ready) return <Page title="Admin">{null}</Page>;
  if (!account)
    return (
      <Page title="Admin" bar={bar}>
        <p>
          <a href="#/signin?next=%23%2Fadmin">Sign in</a> to see the admin console.
        </p>
      </Page>
    );
  if (!account.admin)
    return (
      <Page title="Admin" bar={bar}>
        <p>Only BetterCad&rsquo;s admins can see this page.</p>
      </Page>
    );

  const models = users?.reduce((n, u) => n + u.models.length, 0) ?? 0;
  const projects = users?.reduce((n, u) => n + u.projects.length, 0) ?? 0;
  return (
    <Page title="Admin" wide bar={bar}>
      <h2>Users</h2>
      <div className="bc-lib-tools">
        <input
          className="bc-text"
          type="search"
          aria-label="Search users, projects and models"
          placeholder="Search users, projects and models"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <p role="status" className="bc-page-note">
        {users ? `${plural(users.length, "user")}, ${plural(projects, "project")}, ${plural(models, "model")} saved` : error ? "" : "Loading users…"}
      </p>
      {error && (
        <p className="bc-page-error" role="alert">
          {error}
        </p>
      )}
      {shown && shown.length === 0 && <p>{q ? `Nobody matches ‘${q}’.` : "Nobody has signed in yet."}</p>}
      {shown && shown.length > 0 && (
        <ul className="bc-admin-users" aria-label="Users">
          {shown.map((u) => (
            <UserRow key={u.id} u={u} url={api.url} />
          ))}
        </ul>
      )}
      <Suspense fallback={null}>
        <AdminParts api={api} />
      </Suspense>
    </Page>
  );
}
