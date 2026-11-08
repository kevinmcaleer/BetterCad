import { useEffect, useMemo, useRef, useState } from "react";
import { Banner, Button, Dialog, NumberField } from "@bettercad/ui";
import { DEFLECTION, type Call, type ExportEstimate, type ExportFormat, type ExportRequest, type Methods, type Resolution } from "@bettercad/kernel";
import type { ModelDoc, Part } from "../state/document";
import type { FileStore } from "../files/fileStore";
import { formatBytes } from "./format";

export { formatBytes };

/**
 * One dialog for every export (#86): the format, which bodies, how fine, on the bed or where they are, and a live
 * estimate of the triangles and file size. The files come from the exact B-rep in the kernel (#80, #81).
 */
export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  /** The printer the model is for, and why it doesn't fit, if it doesn't (#100). */
  printer?: string;
  fitProblem?: string | null;
  /** After files were saved (the tour's last step, #98). */
  onExported?: () => void;
  doc: ModelDoc;
  upTo: number;
  parts: Part[];
  selection: string[];
  call: <M extends keyof Methods>(method: M, params: Methods[M]["params"]) => Call<Methods[M]["result"]> | null;
  files: FileStore;
  say: (text: string, bad?: boolean) => void;
  /** Group the chosen bodies, so hole shapes cut the solids they overlap. */
  onGroup: (ids: string[]) => void;
  /** Open on this format instead of the last one chosen (Render offers glTF). */
  format?: ExportFormat;
}

type What = "all" | "selected" | "each";
type Res = Resolution | "custom";

interface Choices {
  format: ExportFormat;
  what: What;
  res: Res;
  custom: number;
  keepPosition: boolean;
  /** As the joints are posed (#173), not at home. */
  posed: boolean;
  /** URDF (#175): mesh paths for a ROS package. */
  rosPackage: boolean;
}

const KEY = "bettercad.export";
const DEFAULTS: Choices = { format: "stl", what: "all", res: "normal", custom: 0.05, keepPosition: false, posed: false, rosPackage: false };
const MIME: Record<string, string> = {
  ".stl": "model/stl",
  ".3mf": "model/3mf",
  ".step": "model/step",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".zip": "application/zip",
};
const mimeOf = (name: string) => MIME[name.slice(name.lastIndexOf(".")).toLowerCase()] ?? "application/octet-stream";
const FORMATS: { id: ExportFormat; label: string; title: string }[] = [
  { id: "stl", label: "STL", title: "Triangles, for any slicer" },
  { id: "3mf", label: "3MF", title: "Triangles in millimetres, one object per body, for modern slicers" },
  { id: "step", label: "STEP", title: "Exact solids, for Fusion, FreeCAD and CNC" },
  { id: "glb", label: "GLB", title: "One file with looks, in metres, for Blender and web viewers" },
  { id: "gltf", label: "glTF", title: "glTF with a .bin beside it, in metres, for Blender and web viewers" },
  { id: "urdf", label: "URDF", title: "The robot's links and joints, with a mesh per link, for Snakie, ROS, MuJoCo and Gazebo" },
];
const RESOLUTIONS: { id: Res; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "normal", label: "Normal" },
  { id: "fine", label: "Fine" },
  { id: "custom", label: "Custom" },
];
const BIG = 2_000_000;

function load(): Choices {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Choices>) };
  } catch {
    return DEFAULTS;
  }
}

export function ExportDialog(p: ExportDialogProps) {
  const [c, setC] = useState<Choices>(() => (p.format ? { ...load(), format: p.format } : load()));
  const set = (change: Partial<Choices>) =>
    setC((o) => {
      const n = { ...o, ...change };
      try {
        localStorage.setItem(KEY, JSON.stringify(n));
      } catch {
        // Kept for this visit only.
      }
      return n;
    });
  const [estimate, setEstimate] = useState<ExportEstimate | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef<Call<unknown> | null>(null);

  const what: What = c.what === "selected" && !p.selection.length ? "all" : c.what;
  const hasPose = !!p.doc.pose && Object.keys(p.doc.pose).length > 0;
  const deflection = c.res === "custom" ? Math.max(0.001, c.custom) : DEFLECTION[c.res];
  const req = useMemo<ExportRequest>(
    () => ({
      doc: p.doc,
      upTo: p.upTo,
      bodies: what === "selected" ? p.selection : null,
      format: c.format,
      deflection,
      separate: what === "each",
      keepPosition: c.keepPosition,
      posed: hasPose && c.posed,
      rosPackage: c.rosPackage,
    }),
    [p.doc, p.upTo, p.selection, what, c.format, deflection, c.keepPosition, hasPose, c.posed, c.rosPackage],
  );

  // The estimate follows the choices; its triangles are kept for the export.
  const { call, open } = p;
  useEffect(() => {
    if (!open) return;
    setEstimate(null);
    const k = call("estimate", req);
    if (!k) {
      setEstimate({ error: "The geometry engine is off, so nothing can be exported." });
      return;
    }
    k.then(setEstimate, (e: { message?: string; code?: string }) => e?.code !== "cancelled" && setEstimate({ error: e?.message ?? "That can't be exported." }));
    return () => k.cancel();
  }, [open, call, req]);

  const chosen = what === "selected" ? p.parts.filter((x) => p.selection.includes(x.id)) : p.parts;
  const name = p.doc.name;

  const run = async () => {
    const k = p.call("export", { ...req, name });
    if (!k) return;
    running.current = k;
    setBusy(true);
    try {
      const r = await k;
      const saved = await p.files.saveFiles(r.files.map((f) => ({ ...f, mime: mimeOf(f.name) })));
      if (!saved) return;
      p.say(`Exported ${saved.names.length === 1 ? saved.names[0] : `${saved.names.length} files`}`);
      p.onExported?.();
      p.onClose();
    } catch (e) {
      const err = e as { message?: string; code?: string };
      if (err?.code !== "cancelled") p.say(err?.message ?? "That didn't export.", true);
    } finally {
      running.current = null;
      setBusy(false);
    }
  };

  const cancel = () => {
    if (running.current) running.current.cancel();
    else p.onClose();
  };

  if (!p.open) return null;
  const est = estimate && !("error" in estimate) ? estimate : null;
  const step = c.format === "step";
  const urdf = c.format === "urdf";
  return (
    <Dialog
      open
      modal
      title="Export"
      icon="download"
      onCancel={cancel}
      width={460}
      footer={
        <>
          <Button kind="cancel" label={busy ? "Stop" : "Cancel"} onClick={cancel} />
          <Button kind="done" label={busy ? "Exporting…" : "Export"} disabled={busy || !est} onClick={() => void run()} />
        </>
      }
    >
      {p.fitProblem && <Banner tone="warn">{p.fitProblem}</Banner>}
      <div className="bc-export">
        {p.printer && !p.fitProblem && <p className="bc-note bc-export-printer">For {p.printer}.</p>}
        <span className="bc-field-label" id="bc-ex-format">
          Format
        </span>
        <span role="group" aria-labelledby="bc-ex-format" className="bc-segmented">
          {FORMATS.map((f) => (
            <Button key={f.id} label={f.label} title={f.title} on={c.format === f.id} onClick={() => set({ format: f.id })} />
          ))}
        </span>
        {urdf ? (
          <>
            <p className="bc-note">Every body goes in, at home, one link per link step, as a .zip.</p>
            <label className="bc-check">
              <input type="checkbox" checked={c.rosPackage} onChange={(e) => set({ rosPackage: e.target.checked })} />
              <span>Paths for a ROS package (package://)</span>
            </label>
          </>
        ) : (
          <>
            <span className="bc-field-label" id="bc-ex-what">
              What
            </span>
            <span role="group" aria-labelledby="bc-ex-what" className="bc-segmented">
              <Button label="All bodies" on={what === "all"} onClick={() => set({ what: "all" })} />
              <Button
                label="Selected"
                title={p.selection.length ? "Only the selected bodies" : "Select bodies first"}
                disabled={!p.selection.length}
                on={what === "selected"}
                onClick={() => set({ what: "selected" })}
              />
              <Button label="Each on its own" title="One file per body" on={what === "each"} onClick={() => set({ what: "each" })} />
            </span>
          </>
        )}
        {!step && (
          <>
            <span className="bc-field-label" id="bc-ex-res">
              Resolution
            </span>
            <span className="bc-export-res">
              <span role="group" aria-labelledby="bc-ex-res" className="bc-segmented">
                {RESOLUTIONS.map((r) => (
                  <Button key={r.id} label={r.label} on={c.res === r.id} onClick={() => set({ res: r.id })} />
                ))}
              </span>
              {c.res === "custom" ? (
                <NumberField label="Deviation" value={c.custom} min={0.001} max={1} step={0.01} precision={3} onCommit={(v) => set({ custom: v })} />
              ) : (
                <span className="bc-note bc-micro">Within {deflection} mm of the true surface</span>
              )}
            </span>
            {!urdf && (
              <label className="bc-check">
                <input type="checkbox" checked={!c.keepPosition} onChange={(e) => set({ keepPosition: !e.target.checked })} />
                <span>Place on the bed (lowest point at Z = 0)</span>
              </label>
            )}
          </>
        )}
        {hasPose && !urdf && (
          <label className="bc-check">
            <input type="checkbox" checked={c.posed} onChange={(e) => set({ posed: e.target.checked })} />
            <span>Export as posed (otherwise every joint is at home)</span>
          </label>
        )}
        <p className="bc-export-estimate" role="status">
          {estimate === null
            ? "Working out the size…"
            : "error" in estimate
              ? estimate.error
              : step
                ? `${estimate.solids} ${estimate.solids === 1 ? "solid" : "solids"}, exact`
                : urdf
                  ? `${estimate.solids} ${estimate.solids === 1 ? "mesh" : "meshes"} · ≈ ${estimate.triangles.toLocaleString("en-GB")} triangles · ${formatBytes(estimate.bytes)}`
                  : `≈ ${estimate.triangles.toLocaleString("en-GB")} triangles · ${formatBytes(estimate.bytes)}`}
        </p>
        {est && est.triangles > BIG && <Banner tone="warn">Large files can slow your slicer. Try Normal or Draft.</Banner>}
        {est && est.skipped > 0 && (
          <Banner
            tone="warn"
            action={
              <Button
                size="dense"
                label="Group them now"
                title="Group the hole shapes with the solids they overlap"
                onClick={() => p.onGroup(chosen.map((x) => x.id))}
              />
            }
          >
            {est.skipped === 1 ? "1 hole shape wasn't" : `${est.skipped} hole shapes weren't`} exported. Group them with a solid first.
          </Banner>
        )}
        {busy && <progress className="bc-progress" aria-label="Exporting" />}
      </div>
    </Dialog>
  );
}
