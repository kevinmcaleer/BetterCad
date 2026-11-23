import { useId, useState } from "react";
import { Button, Dialog } from "@bettercad/ui";
import { scaleLabel, viewScale, type Drawing, type DrawingSheet } from "@bettercad/kernel/drawing";
import type { ModelView } from "@bettercad/kernel/view";
import { follow } from "./follow";
import { sheetLayout, sizeName, type SheetLayout } from "./layout";
import { pixels } from "./export/browser";
import { sheetScene, viewScene, type Scene } from "./export/scene";
import { viewName } from "./views";

export type DrawingFormat = "pdf" | "svg" | "dxf" | "png";

/** A file on its way out: its bytes may still be being made when the browser asks where to save it. */
export interface DrawingFile {
  name: string;
  data: Promise<ArrayBuffer>;
  mime: string;
}

export interface ExportCardProps {
  drawing: Drawing;
  sheet: DrawingSheet;
  layout: SheetLayout;
  /** The kernel's picture of a view, once it has one. */
  viewOf: (id: string) => ModelView | undefined;
  /** The pictures of another sheet's views (#572), for all the sheets in one PDF. Left out, only this sheet exports. */
  viewsOf?: (sheet: DrawingSheet) => Promise<(id: string) => ModelView | undefined>;
  /** Asks where to save and writes the file; the name it was saved under, or nothing when the person backed out. */
  onSave: (file: DrawingFile) => Promise<string | undefined>;
  say: (text: string, bad?: boolean) => void;
  onClose: () => void;
}

const FORMATS: { id: DrawingFormat; label: string; title: string; mime: string }[] = [
  { id: "pdf", label: "PDF", title: "One page at the sheet's exact size, sharp at any zoom, for printing and sharing", mime: "application/pdf" },
  { id: "svg", label: "SVG", title: "The sheet in millimetres, for Inkscape, Illustrator and the web", mime: "image/svg+xml" },
  { id: "dxf", label: "DXF", title: "Lines on layers, for other CAD programs and laser cutters", mime: "image/vnd.dxf" },
  { id: "png", label: "PNG", title: "A picture, for build steps and lessons", mime: "image/png" },
];
const KEY = "bettercad.drawingExport";
interface Choices {
  format: DrawingFormat;
  dpi: 150 | 300;
}
function load(): Choices {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Choices>;
    return { format: FORMATS.some((f) => f.id === c.format) ? c.format! : "pdf", dpi: c.dpi === 300 ? 300 : 150 };
  } catch {
    return { format: "pdf", dpi: 150 };
  }
}

/** The file's name, from the title block: "Bracket rev A". */
export function exportName(drawing: Drawing, sheet: DrawingSheet): string {
  const title = sheet.title.title?.trim() || drawing.name;
  const rev = sheet.title.revision?.trim();
  return (rev ? `${title} rev ${rev}` : title).replace(/[\\/:*?"<>|]+/g, " ").trim() || "Drawing";
}

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const font = () => import("../sketch/text/glyphs").then((m) => m.glyphFont("inter"));

/** The bytes of a scene in a format. The writers load when they are first used. */
export async function exportBytes(scene: Scene, format: DrawingFormat, o: { dpi?: number; title?: string; author?: string } = {}): Promise<ArrayBuffer> {
  if (format === "dxf") return bytes((await import("./export/dxf")).sceneDxf(scene));
  const { sceneSvg } = await import("./export/svg");
  if (format === "svg") return bytes(sceneSvg(scene));
  const { outlines } = await import("./export/outline");
  const text = outlines(scene.labels, await font());
  if (format === "pdf") {
    const { deflated, pdfContent, scenePdf } = await import("./export/pdf");
    const pdf = scenePdf(scene, text, { title: o.title, author: o.author }, await deflated(pdfContent(scene, text)));
    return pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
  }
  const size = pixels(scene, o.dpi ?? 150);
  const { svgPng } = await import("./export/browser");
  return (await svgPng(sceneSvg(scene, { outlines: text, pixels: size }), size)).arrayBuffer();
}

/** Several scenes as the pages of one PDF, each at its own size. */
export async function exportPdfPages(scenes: Scene[], o: { title?: string; author?: string } = {}): Promise<ArrayBuffer> {
  const [{ outlines }, { deflated, pdfContent, pagesPdf }, glyphs] = await Promise.all([import("./export/outline"), import("./export/pdf"), font()]);
  const pages = await Promise.all(
    scenes.map(async (scene) => {
      const text = outlines(scene.labels, glyphs);
      return { scene, outlines: text, packed: await deflated(pdfContent(scene, text)) };
    }),
  );
  const pdf = pagesPdf(pages, o);
  return pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
}

/**
 * Export (#569): the sheet as a PDF, SVG, DXF or PNG, or straight to the printer. A DXF can instead be one view at
 * full size, which is what a laser cutter wants.
 */
export function ExportCard({ drawing, sheet, layout, viewOf, viewsOf, onSave, say, onClose }: ExportCardProps) {
  const id = useId();
  const [c, setC] = useState(load);
  const set = (change: Partial<Choices>) =>
    setC((o) => {
      const next = { ...o, ...change };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Kept for this visit only.
      }
      return next;
    });
  /** For DXF: the whole sheet ("") or one view at full size. */
  const [one, setOne] = useState("");
  const [busy, setBusy] = useState(false);
  /** For PDF: every sheet of the drawing as one file. */
  const [every, setEvery] = useState(false);
  const count = drawing.sheets.length;
  const all = c.format === "pdf" && every && count > 1 && !!viewsOf;
  /** Each sheet as it is drawn, in order: this one from what is on screen, the others from the kernel. */
  const allScenes = async (): Promise<Scene[]> =>
    Promise.all(
      drawing.sheets.map(async (s, i) => {
        if (s.id === sheet.id) return sheetScene(sheet, layout, viewOf, drawing.decimals);
        const of = await viewsOf!(s);
        return sheetScene(follow(s, of, drawing.decimals), sheetLayout(s, { index: i + 1, count }), of, drawing.decimals);
      }),
    );
  const waiting = sheet.views.some((v) => !viewOf(v.id));
  const single = c.format === "dxf" ? sheet.views.find((v) => v.id === one) : undefined;
  const base = exportName(drawing, sheet);
  const page = `${sizeName(sheet.size)} ${sheet.landscape ? "landscape" : "portrait"}, ${layout.page.w} × ${layout.page.h} mm`;
  const px = pixels(layout.page, c.dpi);

  const scene = (): Scene => {
    const view = single && viewOf(single.id);
    return view ? viewScene(view, false) : sheetScene(sheet, layout, viewOf, drawing.decimals);
  };
  const run = async () => {
    const f = FORMATS.find((x) => x.id === c.format)!;
    const name = `${single ? `${base} ${viewName(single).toLowerCase()}` : base}.${f.id}`;
    setBusy(true);
    try {
      const o = { dpi: c.dpi, title: base, author: sheet.title.author };
      const saved = await onSave({
        name,
        mime: f.mime,
        data: all ? allScenes().then((scenes) => exportPdfPages(scenes, o)) : exportBytes(scene(), c.format, o),
      });
      if (!saved) return;
      say(`Exported ${saved}`);
      onClose();
    } catch (e) {
      say((e as Error)?.message || "That didn't export.", true);
    } finally {
      setBusy(false);
    }
  };
  const print = async () => {
    setBusy(true);
    try {
      const s = sheetScene(sheet, layout, viewOf, drawing.decimals);
      const [{ sceneSvg }, { outlines }, { printSvg }] = await Promise.all([import("./export/svg"), import("./export/outline"), import("./export/browser")]);
      printSvg(sceneSvg(s, { outlines: outlines(s.labels, await font()) }), layout.page, base);
      onClose();
    } catch (e) {
      say((e as Error)?.message || "That didn't print.", true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      modal
      title="Export drawing"
      icon="download"
      width={420}
      onCancel={onClose}
      footer={
        <>
          <Button kind="cancel" label="Cancel" onClick={onClose} />
          <Button label="Print" title="Open the print dialog with the page size set and no margins" disabled={busy || waiting} onClick={() => void print()} />
          <Button kind="done" label={busy ? "Exporting…" : "Export"} disabled={busy || waiting} onClick={() => void run()} />
        </>
      }
    >
      <div className="bc-sheet-card">
        <span className="bc-field-label" id={`${id}-format`}>
          Format
        </span>
        <span role="group" aria-labelledby={`${id}-format`} className="bc-segmented">
          {FORMATS.map((f) => (
            <Button key={f.id} label={f.label} title={f.title} on={c.format === f.id} onClick={() => set({ format: f.id })} />
          ))}
        </span>
        {c.format === "dxf" && (
          <>
            <label className="bc-field-label" htmlFor={`${id}-what`}>
              What
            </label>
            <select id={`${id}-what`} className="bc-select" value={single?.id ?? ""} onChange={(e) => setOne(e.target.value)}>
              <option value="">The whole sheet, at paper scale</option>
              {sheet.views.map((v) => (
                <option key={v.id} value={v.id}>
                  {`${viewName(v)} only, at full size`}
                </option>
              ))}
            </select>
          </>
        )}
        {c.format === "pdf" && count > 1 && viewsOf && (
          <>
            <label className="bc-field-label" htmlFor={`${id}-sheets`}>
              Sheets
            </label>
            <select id={`${id}-sheets`} className="bc-select" value={every ? "all" : "one"} onChange={(e) => setEvery(e.target.value === "all")}>
              <option value="one">{`This sheet (${sheet.name})`}</option>
              <option value="all">{`All ${count} sheets, one page each`}</option>
            </select>
          </>
        )}
        {c.format === "png" && (
          <>
            <span className="bc-field-label" id={`${id}-dpi`}>
              Resolution
            </span>
            <span role="group" aria-labelledby={`${id}-dpi`} className="bc-segmented">
              <Button label="150 dpi" title="For screens, build steps and lessons" on={c.dpi === 150} onClick={() => set({ dpi: 150 })} />
              <Button label="300 dpi" title="For print" on={c.dpi === 300} onClick={() => set({ dpi: 300 })} />
            </span>
          </>
        )}
        <p className="bc-note" role="status">
          {waiting
            ? "Working out the views."
            : single
              ? `Just the edges you see, in the model's own millimetres (the sheet shows it at ${scaleLabel(viewScale(sheet, single))}).`
              : c.format === "png"
                ? `${page}: ${px.w} × ${px.h} pixels.`
                : all
                  ? `${count} pages, each at its sheet's size. Black on white, whatever the theme.`
                  : `${page}. Black on white, whatever the theme.`}
        </p>
      </div>
    </Dialog>
  );
}
