import { Fragment, useCallback, useEffect, useState } from "react";
import { Button, Dialog } from "@bettercad/ui";
import { fileName } from "@bettercad/kernel/bcad";
import { serverTime, type Api, type VersionInfo } from "./api";
import { formatBytes } from "../export/ExportDialog";

/**
 * Version history (#91): every save to the account, newest first. Autosaves fold into one row per run; a version
 * opens read-only in the editor with Restore and Back over the view.
 */
export interface VersionsProps {
  api: Api;
  modelId: string;
  name: string;
  /** The version on show, if it is an old one. */
  viewing: number | null;
  onPreview: (n: number) => void;
  onClose: () => void;
  say: (text: string, bad?: boolean) => void;
}

type Row = { kind: "one"; v: VersionInfo } | { kind: "autosaves"; list: VersionInfo[] };

/** Runs of autosaves become one row, so a long session reads as a handful of lines. */
export function groupVersions(list: VersionInfo[]): Row[] {
  const rows: Row[] = [];
  for (const v of list) {
    const last = rows.at(-1);
    if (v.note === "autosave" && last?.kind === "autosaves") last.list.push(v);
    else if (v.note === "autosave" && v !== list[0]) rows.push({ kind: "autosaves", list: [v] });
    else rows.push({ kind: "one", v });
  }
  // A single autosave needs no folding.
  return rows.map((r) => (r.kind === "autosaves" && r.list.length === 1 ? { kind: "one", v: r.list[0]! } : r));
}

const when = (t: string) => new Date(serverTime(t)).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Versions(p: VersionsProps) {
  const [list, setList] = useState<VersionInfo[] | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { api, modelId, say } = p;

  const load = useCallback(async () => {
    try {
      const r = await api.versions(modelId);
      setList(r.versions);
      setNote(r.versions[0]?.note && r.versions[0].note !== "autosave" ? r.versions[0].note : "");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, modelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (n: number) => {
    try {
      const v = await api.version(modelId, n);
      const url = URL.createObjectURL(new Blob([v.bcad], { type: "application/vnd.bettercad+json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName(`${p.name} v${n}`);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      say(`Downloaded version ${n}`);
    } catch (e) {
      say((e as Error).message, true);
    }
  };

  const saveNote = async () => {
    const latest = list?.[0];
    if (!latest) return;
    try {
      await api.noteVersion(modelId, latest.number, note.trim());
      say("Note saved");
      await load();
    } catch (e) {
      say((e as Error).message, true);
    }
  };

  const one = (v: VersionInfo, latest: boolean) => (
    <li key={v.number} className={p.viewing === v.number ? "bc-version bc-on" : "bc-version"}>
      <span className="bc-version-thumb">{v.thumbnail ? <img src={api.url(v.thumbnail)} alt="" width={64} height={40} loading="lazy" /> : null}</span>
      <span className="bc-version-text">
        <span className="bc-version-title">
          Version {v.number}
          {latest ? " · current" : ""}
        </span>
        <span className="bc-version-meta">
          {when(v.created)} · {formatBytes(v.size)}
          {v.note && v.note !== "autosave" ? ` · ${v.note}` : v.note === "autosave" ? " · autosave" : ""}
        </span>
      </span>
      {!latest && <Button size="dense" label={p.viewing === v.number ? "Viewing" : "View"} on={p.viewing === v.number} onClick={() => p.onPreview(v.number)} />}
      <Button size="dense" icon="download" title={`Download version ${v.number}`} onClick={() => void download(v.number)} />
    </li>
  );

  return (
    <Dialog open title="Version history" icon="history" onCancel={p.onClose} width={480}>
      <div className="bc-versions">
        {error && (
          <p className="bc-page-error" role="alert">
            {error}
          </p>
        )}
        {list === null && !error && <p className="bc-note">Loading the versions…</p>}
        {list && list.length > 0 && (
          <>
            <div className="bc-version-note">
              <label className="bc-field-label" htmlFor="bc-version-note">
                Note on version {list[0]!.number}
              </label>
              <span className="bc-version-note-row">
                <input
                  id="bc-version-note"
                  className="bc-text"
                  value={note}
                  maxLength={200}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What changed"
                />
                <Button size="dense" label="Save note" onClick={() => void saveNote()} />
              </span>
            </div>
            <ul className="bc-version-list" aria-label="Versions">
              {groupVersions(list).map((row, i) =>
                row.kind === "one" ? (
                  one(row.v, i === 0)
                ) : (
                  <Fragment key={`a${row.list[0]!.number}`}>
                    <li className="bc-version bc-version-group">
                      <Button
                        size="dense"
                        icon="chevron"
                        aria-expanded={open.has(row.list[0]!.number)}
                        label={`${row.list.length} autosaves`}
                        title={`Versions ${row.list.at(-1)!.number} to ${row.list[0]!.number}`}
                        onClick={() =>
                          setOpen((s) => {
                            const n = new Set(s);
                            const k = row.list[0]!.number;
                            if (n.has(k)) n.delete(k);
                            else n.add(k);
                            return n;
                          })
                        }
                      />
                    </li>
                    {open.has(row.list[0]!.number) && row.list.map((v) => one(v, false))}
                  </Fragment>
                ),
              )}
            </ul>
          </>
        )}
        <p className="bc-note bc-micro">Every save is kept for 30 days. After that the last 10 older versions stay, and any a share link shows.</p>
      </div>
    </Dialog>
  );
}
