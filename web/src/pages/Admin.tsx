import { useEffect, useMemo, useState } from "react";
import { Button, Icon } from "@bettercad/ui";
import { ApiError, serverTime, type AdminModel, type AdminUser } from "../cloud/api";
import { useAccount } from "../cloud/account";
import { go } from "../cloud/route";
import { ago } from "../files/autosave";
import { formatBytes } from "../export/format";
import { Page } from "./Page";

/**
 * The admin console (#/admin): everyone who has signed in to BetterCad, newest activity first, and the models each has
 * saved. Only accounts in ADMIN_EMAILS see it; the server checks on every call.
 */

const when = (t: string | null) => (t ? ago(Date.now() - serverTime(t)) : "never");
/** "Last seen" is a day, not a moment: today reads as today rather than "9 hours ago". */
const day = (d: string | null) => {
  if (!d) return "not recorded";
  const today = new Date().toISOString().slice(0, 10);
  return d === today ? "today" : when(d);
};
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function ModelRow({ m, url }: { m: AdminModel; url: (path: string) => string }) {
  const [pic, setPic] = useState(!!m.thumbnail);
  return (
    <li className="bc-admin-model">
      <span className="bc-admin-thumb" aria-hidden="true">
        {m.thumbnail && pic ? (
          <img src={url(m.thumbnail)} alt="" width={64} height={40} loading="lazy" onError={() => setPic(false)} />
        ) : (
          <Icon name="cube" size={20} />
        )}
      </span>
      <span className="bc-admin-model-text">
        <span className="bc-card-name">{m.name}</span>
        <span className="bc-page-note">
          Saved {when(m.modified)} · {plural(m.versions, "version")} · {formatBytes(m.size)}
          {m.shared ? " · Shared" : ""}
          {m.deleted_at ? " · In the bin" : ""}
        </span>
      </span>
    </li>
  );
}

function UserRow({ u, url }: { u: AdminUser; url: (path: string) => string }) {
  const live = u.models.filter((m) => !m.deleted_at).length;
  const binned = u.models.length - live;
  return (
    <li className="bc-admin-user">
      <details>
        <summary>
          <span className="bc-admin-name">
            {u.username}
            {u.set_aside && <span className="bc-page-note"> (old sign-in, not claimed)</span>}
          </span>
          <span className="bc-page-note">
            {plural(live, "model")}
            {binned ? `, ${binned} in the bin` : ""} · {formatBytes(u.size)} · Joined {when(u.joined)} · Last seen {day(u.last_seen)}
          </span>
        </summary>
        {u.models.length ? (
          <ul className="bc-admin-models" aria-label={`${u.username}'s models`}>
            {u.models.map((m) => (
              <ModelRow key={m.id} m={m} url={url} />
            ))}
          </ul>
        ) : (
          <p className="bc-page-note">No saved models yet.</p>
        )}
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
    return users.filter((u) => u.username.toLowerCase().includes(t) || u.models.some((m) => m.name.toLowerCase().includes(t)));
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
  return (
    <Page title="Admin" wide bar={bar}>
      <h2>Users</h2>
      <div className="bc-lib-tools">
        <input
          className="bc-text"
          type="search"
          aria-label="Search users and models"
          placeholder="Search users and models"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <p role="status" className="bc-page-note">
        {users ? `${plural(users.length, "user")}, ${plural(models, "model")} saved` : error ? "" : "Loading users…"}
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
    </Page>
  );
}
