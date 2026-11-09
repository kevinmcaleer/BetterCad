import { useCallback, useEffect, useState } from "react";
import { Banner, Button, Dialog, ESC, Icon, MenuButton, cx, useEscape, type MenuEntry } from "@bettercad/ui";
import { fileName, saveBcad } from "@bettercad/kernel/bcad";
import { newDoc } from "../state/document";
import { ApiError, serverTime, type ModelSummary, type Usage } from "../cloud/api";
import { offline } from "../cloud/offline";
import { useAccount } from "../cloud/account";
import { go } from "../cloud/route";
import { ago } from "../files/autosave";
import { formatBytes } from "../export/format";
import { Page } from "./Page";
import { SampleCards } from "../samples/SampleCards";

/**
 * My models (#89): cards with thumbnails, search and sort, rename in place, duplicate, download, and a 30-day bin.
 * Opening a card goes to "#/edit/<id>", which loads the model in the editor.
 */

const MB = 1024 * 1024;
export const formatMB = (n: number) => `${n < 10 * MB ? (n / MB).toFixed(1).replace(/\.0$/, "") : Math.round(n / MB)} MB`;

function Thumb({ src }: { src: string | null }) {
  const [state, setState] = useState<"loading" | "done" | "none">(src ? "loading" : "none");
  return (
    <span className={cx("bc-thumb", state === "loading" && "bc-loading")}>
      {src && state !== "none" ? (
        <img
          src={src}
          alt=""
          width={320}
          height={200}
          loading="lazy"
          onLoad={() => setState("done")}
          onError={() => setState("none")}
          // Not `hidden`: a lazy image with no box never loads, so the card would keep the cube for good.
          className={cx(state === "loading" && "bc-thumb-pending")}
        />
      ) : null}
      {state !== "done" && <Icon name="cube" size={40} />}
    </span>
  );
}

function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name);
  useEscape(true, () => onDone(null), ESC.overlay);
  return (
    <input
      className="bc-text"
      aria-label="New name"
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => onDone(value.trim() && value.trim() !== name ? value.trim() : null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

export function Library({ bin = false }: { bin?: boolean }) {
  const { api, account, ready } = useAccount();
  const [models, setModels] = useState<ModelSummary[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"modified" | "name">("modified");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ModelSummary | null>(null);
  const [stale, setStale] = useState(false);

  const load = useCallback(async () => {
    if (!account) return;
    try {
      const [list, use] = await Promise.all([api.list({ q, sort, bin }), api.usage()]);
      setModels(list.models);
      setUsage(use);
      setError(null);
      setStale(false);
      if (!q && !bin) void offline().rememberList(list.models);
    } catch (e) {
      // Offline (#96): the last list this browser saw, read-only.
      const last = e instanceof ApiError && e.status === 0 && !bin ? await offline().lastList() : null;
      if (last) {
        setModels(q ? last.filter((m) => m.name.toLowerCase().includes(q.toLowerCase())) : last);
        setStale(true);
        setError(null);
      } else setError((e as Error).message);
    }
  }, [api, account, q, sort, bin]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 200 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      setStatus(done);
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  const create = () =>
    act(async () => {
      const m = await api.create("Untitled model", saveBcad(newDoc()));
      go(`#/edit/${m.id}`);
    }, "Made a new model");

  const download = async (m: ModelSummary) => {
    try {
      const full = await api.get(m.id);
      const url = URL.createObjectURL(new Blob([full.bcad], { type: "application/vnd.bettercad+json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName(m.name);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Downloaded ${fileName(m.name)}`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  if (!ready) return <Page title="My models">{null}</Page>;
  if (!account)
    return (
      <Page title="My models">
        <p>
          <a href="#/signin?next=%23%2Flibrary">Sign in</a> to see the models saved to your account. Without one, the editor saves to your disk.
        </p>
      </Page>
    );

  const entries = (m: ModelSummary): MenuEntry[] =>
    bin
      ? [
          { id: "restore", label: "Restore", icon: "undo", onSelect: () => void act(() => api.undelete(m.id), `Restored ${m.name}`) },
          {
            id: "forever",
            label: "Delete for ever",
            icon: "trash",
            danger: true,
            onSelect: () => void act(() => api.remove(m.id, true), `Deleted ${m.name} for ever`),
          },
        ]
      : [
          { id: "open", label: "Open", icon: "folder", onSelect: () => go(`#/edit/${m.id}`) },
          { id: "rename", label: "Rename", icon: "pencil", onSelect: () => setRenaming(m.id) },
          { id: "duplicate", label: "Duplicate", icon: "copy", onSelect: () => void act(() => api.duplicate(m.id), `Made ${m.name} copy`) },
          { id: "download", label: "Download .bcad", icon: "download", onSelect: () => void download(m) },
          { kind: "separator", id: "s" },
          { id: "delete", label: "Delete…", icon: "trash", danger: true, onSelect: () => setDeleting(m) },
        ];

  return (
    <Page
      title={bin ? "Bin" : "My models"}
      wide
      bar={
        <>
          <Button label="Editor" icon="cube" onClick={() => go("#/")} />
          <Button label="Account" icon="user" onClick={() => go("#/account")} />
        </>
      }
    >
      <div className="bc-lib-tools">
        {!bin && <Button variant="primary" icon="plus" label="New model" onClick={() => void create()} />}
        <input className="bc-text" type="search" aria-label="Search by name" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
        <span role="group" aria-label="Sort" className="bc-segmented">
          <Button label="Recent" on={sort === "modified"} onClick={() => setSort("modified")} />
          <Button label="Name" on={sort === "name"} onClick={() => setSort("name")} />
        </span>
        <span className="bc-grow" />
        {bin ? <Button label="Back to my models" onClick={() => go("#/library")} /> : <Button label="Bin" icon="trash" onClick={() => go("#/library/bin")} />}
      </div>
      <p role="status" className="bc-page-note">
        {status}
      </p>
      {error && (
        <p className="bc-page-error" role="alert">
          {error}
        </p>
      )}
      {stale && <Banner tone="warn">You&rsquo;re offline. Showing your last synced models.</Banner>}
      {bin && <p className="bc-page-note">Models stay in the bin for 30 days, then they&rsquo;re deleted.</p>}
      {models && models.length === 0 && (
        <div className="bc-lib-empty">
          <p>{bin ? "The bin is empty." : q ? `No models match ‘${q}’.` : "No models yet"}</p>
          {!bin && !q && <Button variant="primary" icon="plus" label="New model" onClick={() => void create()} />}
          {!bin && !q && <SampleCards onOpen={(id) => go(`#/sample/${id}`)} title="Or start from a sample" />}
        </div>
      )}
      {models && models.length > 0 && (
        <ul className="bc-lib-grid" aria-label={bin ? "Deleted models" : "Your models"}>
          {models.map((m) => (
            <li key={m.id} className="bc-card">
              <button
                type="button"
                className="bc-card-open"
                aria-label={bin ? `${m.name}, in the bin` : `Open ${m.name}`}
                onClick={() => !bin && go(`#/edit/${m.id}`)}
                disabled={bin}
              >
                <Thumb src={m.thumbnail ? api.url(m.thumbnail) : null} />
              </button>
              <div className="bc-card-foot">
                <div className="bc-card-text">
                  {renaming === m.id ? (
                    <RenameField
                      name={m.name}
                      onDone={(name) => {
                        setRenaming(null);
                        if (name) void act(() => api.rename(m.id, name), `Renamed to ${name}`);
                      }}
                    />
                  ) : (
                    <div className="bc-card-name" title={m.name}>
                      {m.name}
                    </div>
                  )}
                  <div className="bc-card-time">{ago(Date.now() - serverTime(bin && m.deleted_at ? m.deleted_at : m.modified))}</div>
                  {m.size != null && (
                    <div className="bc-card-size" title={m.versions && m.versions > 1 ? `${formatBytes(m.size)} across ${m.versions} versions` : undefined}>
                      {formatBytes(m.size)}
                    </div>
                  )}
                </div>
                <MenuButton
                  label={`${m.name} menu`}
                  align="end"
                  entries={entries(m)}
                  trigger={(t) => <Button {...t} icon="more" title={`More for ${m.name}`} />}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {usage && (
        <p className="bc-lib-usage">
          {usage.models} {usage.models === 1 ? "model" : "models"} · {formatMB(usage.bytes)} of {formatMB(usage.quota)}
        </p>
      )}
      {deleting && (
        <Dialog
          open
          title={`Delete ${deleting.name}?`}
          icon="trash"
          onCancel={() => setDeleting(null)}
          footer={
            <>
              <Button kind="cancel" label="Cancel" onClick={() => setDeleting(null)} />
              <Button
                variant="danger"
                label="Delete"
                onClick={() => {
                  const m = deleting;
                  setDeleting(null);
                  void act(() => api.remove(m.id), `Moved ${m.name} to the bin`);
                }}
              />
            </>
          }
        >
          <p>It goes to the bin for 30 days, where you can restore it.</p>
        </Dialog>
      )}
      <footer className="bc-page-note bc-lib-foot">
        <a href="#/privacy">Privacy</a> · <a href="#/terms">Terms</a>
      </footer>
    </Page>
  );
}
