import { lazy, Suspense, useId, useMemo, useState } from "react";
import type { ElectronicsDesign } from "@bettercad/electronics";
import { HOUSES, orderPack, pinOnes } from "@bettercad/electronics/fab/pack";
import { Button, Dialog } from "@bettercad/ui";
import { createFileStore } from "../files/fileStore";
import { orderFiles, type SheetFormat } from "./orderFiles";

const FabPreview = lazy(() => import("./FabPreview"));

const mm = (n: number | null) => (n === null ? "none" : `${Math.round(n * 1000) / 1000} mm`);

/**
 * Order the board (#660): pick a board house, read the checklist, look at the files as the house will see them, and
 * save them named and laid out its way. Nothing is uploaded: a link opens the house's own site.
 */
export default function OrderBoard({ design, name, onClose, onParts }: { design: ElectronicsDesign; name: string; onClose: () => void; onParts?: () => void }) {
  const id = useId();
  const [house, setHouse] = useState(HOUSES[0]!.id);
  const [format, setFormat] = useState<SheetFormat>("csv");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const pack = useMemo(() => orderPack(design, house, name), [design, house, name]);
  const place = useMemo(() => (pack ? pinOnes(design, pack.place) : []), [design, pack]);
  if (!pack) return null;
  const blocked = pack.checks.filter((c) => !c.ok && c.blocks);
  const f = pack.facts;

  const save = async () => {
    setBusy(true);
    setBad(false);
    try {
      const files = orderFiles(pack, format);
      const saved = await createFileStore().saveFiles(files, `${pack.zipName.replace(/-gerbers\.zip$/, "")}-${pack.house.id}.zip`);
      if (saved) setNote(`Saved ${saved.names.join(", ")}.`);
    } catch (e) {
      setBad(true);
      setNote((e as Error)?.message || "That didn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      modal
      title="Order the board"
      icon="download"
      width={preview ? 860 : 480}
      className="bc-ec-order"
      onCancel={onClose}
      footer={
        <>
          <Button kind="cancel" label="Close" onClick={onClose} />
          <Button label={preview ? "Hide the preview" : "Preview the files"} on={preview} onClick={() => setPreview(!preview)} />
          <Button kind="done" label={busy ? "Saving…" : "Save the files"} disabled={busy || blocked.length > 0} onClick={() => void save()} />
        </>
      }
    >
      <div className="bc-ec-order-body">
        <span className="bc-field-label" id={`${id}h`}>
          Board house
        </span>
        <span role="group" aria-labelledby={`${id}h`} className="bc-segmented">
          {HOUSES.map((h) => (
            <Button key={h.id} label={h.name} on={house === h.id} onClick={() => setHouse(h.id)} />
          ))}
        </span>

        <dl className="bc-ec-facts" aria-label="What the order form asks">
          <dt>Size</dt>
          <dd>
            {f.width} × {f.height} mm, {f.thickness} mm thick
          </dd>
          <dt>Layers</dt>
          <dd>{f.layers}</dd>
          <dt>Smallest track</dt>
          <dd>{mm(f.minTrack)}</dd>
          <dt>Smallest gap</dt>
          <dd>{mm(f.minGap)}</dd>
          <dt>Smallest hole</dt>
          <dd>{mm(f.minHole)}</dd>
        </dl>

        <ul className="bc-ec-check-list" aria-label="Before you order">
          {pack.checks.map((c) => (
            <li key={c.id} className={c.ok ? "bc-ec-check-ok" : c.blocks ? "bc-ec-check-error" : "bc-ec-check-warning"}>
              <span>
                <span className="bc-sr-only">{c.ok ? "Fine: " : c.blocks ? "Stops the export: " : "To check: "}</span>
                {c.text}
              </span>
              {c.id === "part-numbers" && !c.ok && onParts && <Button label="Open the parts list" onClick={onParts} />}
            </li>
          ))}
        </ul>

        <span className="bc-field-label" id={`${id}s`}>
          Parts lists as
        </span>
        <span role="group" aria-labelledby={`${id}s`} className="bc-segmented">
          <Button label="CSV" title="Plain text every board house reads" on={format === "csv"} onClick={() => setFormat("csv")} />
          <Button label="XLSX" title="A spreadsheet, with part numbers kept as text" on={format === "xlsx"} onClick={() => setFormat("xlsx")} />
        </span>

        <details className="bc-ec-order-files">
          <summary>
            {pack.gerbers.length} files in {pack.zipName}
            {pack.bom.rows.length ? ", a parts list" : ""}
            {pack.place.length ? " and a pick and place list" : ""}
          </summary>
          <ul>
            {pack.gerbers.map((g) => (
              <li key={g.name}>{g.name}</li>
            ))}
          </ul>
          <table className="bc-ec-table" aria-label="Drill table">
            <thead>
              <tr>
                <th scope="col">Hole</th>
                <th scope="col">Plated</th>
                <th scope="col">Holes</th>
                <th scope="col">Slots</th>
              </tr>
            </thead>
            <tbody>
              {pack.tools.map((t) => (
                <tr key={`${t.plated}${t.span ?? ""}${t.tool}`}>
                  <th scope="row">{t.d} mm</th>
                  <td>{t.span ? `Yes, layers ${t.span[0]} to ${t.span[1]}` : t.plated ? "Yes" : "No"}</td>
                  <td>{t.holes}</td>
                  <td>{t.slots}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pack.house.notes.map((n) => (
            <p key={n} className="bc-note">
              {n}
            </p>
          ))}
          {pack.house.source.length > 0 && (
            <p className="bc-note">
              Read from{" "}
              {pack.house.source.map((s, i) => (
                <span key={s}>
                  {i > 0 && " and "}
                  <a href={s} target="_blank" rel="noreferrer">
                    {new URL(s).hostname.replace(/^www\./, "")} ({i + 1})
                  </a>
                </span>
              ))}{" "}
              on {pack.house.checked}.
            </p>
          )}
        </details>

        {preview && (
          <Suspense fallback={<p className="bc-note">Reading the files…</p>}>
            <FabPreview files={pack.gerbers} mask={design.board?.mask ?? "green"} place={place} />
          </Suspense>
        )}

        <p className="bc-note" role={bad ? "alert" : "status"}>
          {note ||
            (blocked.length
              ? "Fix what stops the export, then save."
              : pack.house.site
                ? "Save the files, then upload the Gerber zip on the board house's site. Nothing is sent for you."
                : "Save the files and send them to your board house.")}
        </p>
        {pack.house.site && (
          <a href={pack.house.site} target="_blank" rel="noreferrer">
            Open {pack.house.name}
          </a>
        )}
      </div>
    </Dialog>
  );
}
