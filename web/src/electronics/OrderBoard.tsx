import { lazy, Suspense, useId, useMemo, useState } from "react";
import type { ElectronicsDesign } from "@bettercad/electronics";
import { HOUSES, orderPack, pinOnes } from "@bettercad/electronics/fab/pack";
import { PANEL, type Panel } from "@bettercad/electronics/fab/panel";
import { Button, Dialog, NumberField } from "@bettercad/ui";
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
  const [panel, setPanel] = useState<Panel | null>(null);
  // Which build to order (#758): the parts list and pick and place follow it.
  const [variant, setVariant] = useState<string | null>(null);
  const pack = useMemo(() => orderPack(design, house, name, panel, variant), [design, house, name, panel, variant]);
  const place = useMemo(() => (pack ? pinOnes(design, pack.place) : []), [design, pack]);
  if (!pack) return null;
  const blocked = pack.checks.filter((c) => !c.ok && c.blocks);
  const placed = (design.board?.placements.length ?? 0) > 0;

  /** The whole board in one IPC-2581 file (#662), for an assembler that asks for it. */
  const saveIpc = async () => {
    setBusy(true);
    setBad(false);
    try {
      const { ipc2581 } = await import("@bettercad/electronics/fab/ipc2581");
      const text = ipc2581(design, name)!;
      const base = pack.zipName.replace(/-gerbers\.zip$/, "");
      const data = new TextEncoder().encode(text).buffer as ArrayBuffer;
      const saved = await createFileStore().saveFiles([{ name: `${base}.xml`, mime: "application/xml", data }]);
      if (saved) setNote(`Saved ${saved.names.join(", ")}.`);
    } catch (e) {
      setBad(true);
      setNote((e as Error)?.message || "That didn't save.");
    } finally {
      setBusy(false);
    }
  };

  /** The assembly drawing (#662): a sheet for each side with parts on it, as one PDF. */
  const saveDrawing = async () => {
    setBusy(true);
    setBad(false);
    try {
      const { assemblyPdf } = await import("./ExportSchematic");
      const base = pack.zipName.replace(/-gerbers\.zip$/, "");
      const saved = await createFileStore().saveFiles([{ name: `${base}-assembly.pdf`, mime: "application/pdf", data: assemblyPdf(design, name) }]);
      if (saved) setNote(`Saved ${saved.names.join(", ")}.`);
    } catch (e) {
      setBad(true);
      setNote((e as Error)?.message || "That didn't save.");
    } finally {
      setBusy(false);
    }
  };
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

        {(design.variants?.length ?? 0) > 0 && (
          <label className="bc-field">
            <span>Build</span>
            <select className="bc-select" aria-label="Build" value={variant ?? ""} onChange={({ target: { value } }) => setVariant(value || null)}>
              <option value="">As drawn</option>
              {design.variants!.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="bc-check">
          <input type="checkbox" checked={!!panel} onChange={(e) => setPanel(e.target.checked ? PANEL : null)} />
          Order a panel of boards
        </label>
        {panel && (
          <fieldset className="bc-ec-panel">
            <legend className="bc-sr-only">Panel</legend>
            <NumberField
              label="Rows"
              unit="none"
              value={panel.rows}
              min={1}
              max={20}
              step={1}
              precision={0}
              onCommit={(v) => setPanel({ ...panel, rows: v })}
            />
            <NumberField
              label="Columns"
              unit="none"
              value={panel.cols}
              min={1}
              max={20}
              step={1}
              precision={0}
              onCommit={(v) => setPanel({ ...panel, cols: v })}
            />
            <span className="bc-field-label" id={`${id}j`}>
              Join the boards with
            </span>
            <span role="group" aria-labelledby={`${id}j`} className="bc-segmented">
              <Button
                label="Tabs"
                title="A milled gap, bridged by tabs with holes to snap along"
                on={panel.join === "tabs"}
                onClick={() => setPanel({ ...panel, join: "tabs" })}
              />
              <Button
                label="V-cuts"
                title="The boards touch, and a groove is scored along each line"
                on={panel.join === "vcut"}
                onClick={() => setPanel({ ...panel, join: "vcut" })}
              />
            </span>
            <NumberField label="Rails" value={panel.rail} min={0} max={20} step={1} precision={1} onCommit={(v) => setPanel({ ...panel, rail: v })} />
            {panel.join === "tabs" && (
              <NumberField label="Gap" value={panel.gap} min={0.5} max={10} step={0.5} precision={1} onCommit={(v) => setPanel({ ...panel, gap: v })} />
            )}
          </fieldset>
        )}

        <dl className="bc-ec-facts" aria-label="What the order form asks">
          <dt>Size</dt>
          <dd>
            {f.width} × {f.height} mm, {f.thickness} mm thick
          </dd>
          {pack.panel && (
            <>
              <dt>Boards</dt>
              <dd>
                {pack.panel.boards} on a panel, {pack.panel.join === "tabs" ? "held by tabs" : "V-cut"}
              </dd>
            </>
          )}
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
          <Button
            label="Save as IPC-2581"
            title="The whole board in one XML file, for an assembler that asks for IPC-2581"
            disabled={busy}
            onClick={() => void saveIpc()}
          />
          {placed && (
            <Button
              label="Save the assembly drawing"
              title="A PDF of each side with parts on it: their outlines, pin 1 and references, on a drawing sheet"
              disabled={busy}
              onClick={() => void saveDrawing()}
            />
          )}
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
