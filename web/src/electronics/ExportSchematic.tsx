import { useId, useState } from "react";
import type { ElectronicsDesign, Sheet } from "@bettercad/electronics";
import { Button, Dialog } from "@bettercad/ui";
import { useAccount } from "../cloud/account";
import { exportBytes, exportPdfPages } from "../drawing/ExportCard";
import { createFileStore } from "../files/fileStore";
import { schematicScene, type SchematicPage } from "./sheetScene";

type Format = "pdf" | "svg" | "net";
const FORMATS: { id: Format; label: string; title: string; mime: string }[] = [
  { id: "pdf", label: "PDF", title: "Every sheet at its exact paper size, for printing and sharing", mime: "application/pdf" },
  { id: "svg", label: "SVG", title: "This sheet in millimetres, with text you can still edit, for Inkscape and the web", mime: "image/svg+xml" },
  { id: "net", label: "Netlist", title: "Parts and nets in KiCad's format, for KiCad's board editor and other tools", mime: "text/plain" },
];
const PAPER: SchematicPage["size"][] = ["A4", "A3"];

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const safe = (name: string) => name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Schematic";

/** The bytes of a schematic in a format. The writers load when they are first used. */
export async function schematicBytes(
  design: ElectronicsDesign,
  sheet: Sheet,
  format: Format,
  page: Omit<SchematicPage, "index" | "count">,
): Promise<ArrayBuffer> {
  if (format === "net") {
    const { kicadNetlist } = await import("@bettercad/electronics/kicad/netlist");
    return bytes(kicadNetlist(design, { title: page.title.title, date: page.title.date }));
  }
  const count = design.sheets.length;
  const scene = (s: Sheet) => schematicScene(design, s, { ...page, index: design.sheets.indexOf(s) + 1, count });
  const info = { title: page.title.title, author: page.title.author };
  return format === "svg" ? exportBytes(scene(sheet), "svg", info) : exportPdfPages(design.sheets.map(scene), info);
}

/**
 * Export a schematic (#635): a PDF or SVG on a drawing sheet with its title block, or a netlist for other tools.
 */
export default function ExportSchematic({ design, sheet, name, onClose }: { design: ElectronicsDesign; sheet: Sheet; name: string; onClose: () => void }) {
  const id = useId();
  const { account } = useAccount();
  const [format, setFormat] = useState<Format>("pdf");
  const [size, setSize] = useState<SchematicPage["size"]>("A4");
  const [title, setTitle] = useState(name);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState("");
  const f = FORMATS.find((x) => x.id === format)!;

  const run = async () => {
    setBusy(true);
    setBad("");
    try {
      const page = { size, title: { title: title.trim() || name, author: account?.name, date: new Date().toISOString().slice(0, 10) } };
      const saved = await createFileStore().saveFiles([
        { name: `${safe(title || name)}.${format}`, mime: f.mime, data: schematicBytes(design, sheet, format, page) },
      ]);
      if (saved) onClose();
    } catch (e) {
      setBad((e as Error)?.message || "That didn't export.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      modal
      title="Export schematic"
      icon="download"
      width={420}
      onCancel={onClose}
      footer={
        <>
          <Button kind="cancel" label="Cancel" onClick={onClose} />
          <Button kind="done" label={busy ? "Exporting…" : "Export"} disabled={busy} onClick={() => void run()} />
        </>
      }
    >
      <div className="bc-sheet-card">
        <span className="bc-field-label" id={`${id}f`}>
          Format
        </span>
        <span role="group" aria-labelledby={`${id}f`} className="bc-segmented">
          {FORMATS.map((x) => (
            <Button key={x.id} label={x.label} title={x.title} on={format === x.id} onClick={() => setFormat(x.id)} />
          ))}
        </span>
        {format !== "net" && (
          <>
            <label className="bc-field-label" htmlFor={`${id}p`}>
              Paper
            </label>
            <select id={`${id}p`} className="bc-select" value={size} onChange={(e) => setSize(e.target.value as SchematicPage["size"])}>
              {PAPER.map((p) => (
                <option key={p} value={p}>
                  {p} landscape
                </option>
              ))}
            </select>
            <label className="bc-field-label" htmlFor={`${id}t`}>
              Title
            </label>
            <input id={`${id}t`} className="bc-text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </>
        )}
        <p className="bc-note" role={bad ? "alert" : "status"}>
          {bad || f.title + "."}
        </p>
      </div>
    </Dialog>
  );
}
