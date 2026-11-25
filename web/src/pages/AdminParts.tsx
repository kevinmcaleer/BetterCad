import { lazy, Suspense, useEffect, useState } from "react";
import { Button } from "@bettercad/ui";
import { inflate, isPack, type LibraryPack } from "@bettercad/electronics";
import { ApiError, serverTime, type Api } from "../cloud/api";
import { ago } from "../files/autosave";

/**
 * Parts people published to the shared catalogue (#629), the ones waiting for a look first. A published part is live
 * at once and marked unreviewed; approving it takes the mark off, rejecting it takes the part out of the search.
 */
const PartPreview = lazy(() => import("../electronics/PartPreview").then((m) => ({ default: m.PartPreview })));

type Status = "unreviewed" | "approved" | "rejected";
export interface AdminPart {
  id: number;
  name: string;
  licence: string;
  credit: string;
  by: string;
  status: Status;
  modified: string;
  pack: LibraryPack;
}
const LABEL: Record<Status, string> = { unreviewed: "Waiting for a look", approved: "Approved", rejected: "Rejected" };

function PartRow({ p, onSet }: { p: AdminPart; onSet: (status: Status) => void }) {
  const one = isPack(p.pack) && p.pack.parts[0] ? p.pack.parts[0] : null;
  const def = one ? inflate(p.pack, one) : null;
  return (
    <li className="bc-admin-user">
      <details>
        <summary>
          <span className="bc-admin-name">{p.name}</span>
          <span className="bc-page-note">
            By {p.by} · {p.licence} · Credit: {p.credit || p.by} · Published {ago(Date.now() - serverTime(p.modified))} · {LABEL[p.status]}
          </span>
        </summary>
        <div className="bc-admin-detail">
          {def ? (
            <>
              <Suspense fallback={null}>
                <PartPreview def={def} pkg={0} />
              </Suspense>
              <p className="bc-page-note">
                {def.symbol.pins.length} {def.symbol.pins.length === 1 ? "pin" : "pins"}: {def.symbol.pins.map((x) => `${x.number} ${x.name}`).join(", ")}
              </p>
              <p className="bc-page-note">Packages: {def.packages.map((k) => k.footprint.name).join(", ")}</p>
              {one?.datasheet && /^https?:/.test(one.datasheet) && (
                <p className="bc-page-note">
                  <a href={one.datasheet} target="_blank" rel="noreferrer">
                    Datasheet
                  </a>
                </p>
              )}
            </>
          ) : (
            <p className="bc-page-note">This part cannot be read.</p>
          )}
          <div className="bc-lib-tools">
            {p.status !== "approved" && <Button label="Approve" title={`Mark ${p.name} as checked`} onClick={() => onSet("approved")} />}
            {p.status !== "rejected" && <Button label="Reject" title={`Take ${p.name} out of the catalogue's search`} onClick={() => onSet("rejected")} />}
            {p.status !== "unreviewed" && <Button label="Back to waiting" onClick={() => onSet("unreviewed")} />}
          </div>
        </div>
      </details>
    </li>
  );
}

export function AdminParts({ api }: { api: Api }) {
  const [parts, setParts] = useState<AdminPart[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api.call<{ parts: AdminPart[] }>("GET", "admin/parts-catalogue").then(
      (r) => live && setParts(r.parts),
      (e: unknown) => live && setError(e instanceof ApiError ? e.message : "The published parts couldn't be loaded."),
    );
    return () => {
      live = false;
    };
  }, [api]);
  const set = async (p: AdminPart, status: Status) => {
    setError("");
    try {
      await api.call("POST", `admin/parts-catalogue/${p.id}`, { status });
      setParts((now) => now?.map((x) => (x.id === p.id ? { ...x, status } : x)) ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `${p.name} couldn't be changed.`);
    }
  };
  const waiting = parts?.filter((p) => p.status === "unreviewed").length ?? 0;
  return (
    <>
      <h2>Published parts</h2>
      <p className="bc-page-note">
        {parts
          ? parts.length
            ? `${parts.length} published, ${waiting} waiting for a look`
            : "Nobody has published a part yet."
          : error
            ? ""
            : "Loading parts…"}
      </p>
      {error && (
        <p className="bc-page-error" role="alert">
          {error}
        </p>
      )}
      {parts && parts.length > 0 && (
        <ul className="bc-admin-users" aria-label="Published parts">
          {parts.map((p) => (
            <PartRow key={p.id} p={p} onSet={(s) => void set(p, s)} />
          ))}
        </ul>
      )}
    </>
  );
}
