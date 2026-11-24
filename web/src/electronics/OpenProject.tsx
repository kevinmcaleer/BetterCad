import { useEffect, useId, useState } from "react";
import type { ElectronicsDesign, FootprintDef } from "@bettercad/electronics";
import { Button, Dialog } from "@bettercad/ui";
import { textOf } from "./fileText";
import { loadStarter } from "./starter";

/** What a project's files came to: the design, how much of it was found, and what did not come across. */
export interface Opened {
  design: ElectronicsDesign;
  notes: { name: string; why: string }[];
  found: { sheets: number; parts: number; placed: number; tracks: number; vias: number; pours: number };
}

export const PROJECT_LICENCES = [
  "Not stated",
  "CC-BY-SA 4.0",
  "CC-BY 4.0",
  "CC0 1.0 (no rights kept)",
  "CERN-OHL-P 2.0",
  "CERN-OHL-W 2.0",
  "CERN-OHL-S 2.0",
  "MIT",
  "Apache 2.0",
  "GPL 3.0",
  "All rights reserved",
];

/** Whether a file is one of Eagle's: XML that says so. KiCad 5 used `.sch` too, so the name is not enough. */
const isEagle = (f: { name: string; text: string }) => /<eagle[\s>]/.test(f.text.slice(0, 4000)) || (/\.(sch|brd)$/i.test(f.name) && !/^\s*[(<E]/.test(f.text));

/** Reads a project's files: KiCad's, or Eagle's when a schematic or board of Eagle's is among them. The reader loads when it is first used. */
export async function readProject(
  files: { name: string; text: string }[],
  licence: string,
  known?: (name: string) => FootprintDef | undefined,
): Promise<Opened> {
  if (files.some((f) => /^\s*EESchema/.test(f.text)))
    throw new Error("That schematic was saved by KiCad 5 or older. Open and save the project in KiCad 6 or later first.");
  if (files.some(isEagle)) {
    const { importEagleProject } = await import("@bettercad/electronics/eagle/project");
    return importEagleProject(files, { licence });
  }
  const { importKicadProject } = await import("@bettercad/electronics/kicad/project");
  return importKicadProject(files, { licence, ...(known ? { known } : {}) });
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What was found, as a sentence. */
export function foundLine(f: Opened["found"]): string {
  const sch = `${count(f.parts, "part")} on ${count(f.sheets, "sheet")}`;
  if (!f.placed && !f.tracks) return `Found ${sch}, and no board.`;
  const copper = [count(f.tracks, "track"), count(f.vias, "via"), ...(f.pours ? [count(f.pours, "pour")] : [])];
  return `Found ${sch}, and a board with ${count(f.placed, "part")} placed, ${copper.slice(0, -1).join(", ")} and ${copper[copper.length - 1]}.`;
}

export interface OpenProjectProps {
  /** The design has something in it, which opening a project replaces. */
  replaces: boolean;
  onOpen: (design: ElectronicsDesign) => void;
  onClose: () => void;
}

/**
 * Open a project from KiCad (#663) or from Eagle and Fusion Electronics (#665): pick its schematic and board files,
 * see what was found and what did not come across, then use it as this model's design.
 */
export default function OpenProject({ replaces, onOpen, onClose }: OpenProjectProps) {
  const ids = useId();
  const [files, setFiles] = useState<{ name: string; text: string }[]>([]);
  const [licence, setLicence] = useState(PROJECT_LICENCES[0]!);
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState<Opened | null>(null);
  const [bad, setBad] = useState("");

  useEffect(() => {
    if (!files.length) return;
    let off = false;
    setBusy(true);
    void (async () => {
      try {
        // The starter library's footprints stand in for parts the project has no board for. Without it they come in bare.
        const starter = await loadStarter().catch(() => null);
        const opened = await readProject(files, licence, starter ? (name) => starter.footprints[name] : undefined);
        if (off) return;
        setGot(opened);
        setBad("");
      } catch (e) {
        if (off) return;
        setGot(null);
        setBad((e as Error)?.message || "Those files could not be read.");
      } finally {
        if (!off) setBusy(false);
      }
    })();
    return () => {
      off = true;
    };
  }, [files, licence]);

  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      const read = await Promise.all(Array.from(list).map(async (f) => ({ name: f.name, text: await textOf(f) })));
      setFiles((now) => [...now.filter((x) => !read.some((r) => r.name === x.name)), ...read]);
    } catch (e) {
      setBad((e as Error)?.message || "Those files could not be read.");
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      modal
      title="Open a project"
      icon="folder"
      className="bc-ec-editor bc-ec-import"
      onCancel={onClose}
      footer={
        <>
          <Button kind="cancel" label="Cancel" onClick={onClose} />
          <Button variant="primary" label={replaces ? "Replace this design" : "Open"} disabled={!got} busy={busy} onClick={() => got && onOpen(got.design)} />
        </>
      }
    >
      <label className="bc-field-label" htmlFor={`${ids}files`}>
        Project files
      </label>
      <input
        id={`${ids}files`}
        className="bc-text"
        type="file"
        multiple
        accept=".kicad_sch,.kicad_pcb,.kicad_pro,.sch,.brd"
        onChange={(e) => void pick(e.target.files)}
      />
      <p className="bc-note">
        From KiCad 6 or later, pick every schematic sheet (.kicad_sch), the board (.kicad_pcb) and the project file (.kicad_pro) for its rules. From Eagle 6 or
        later, or Fusion Electronics, pick the schematic (.sch) and the board (.brd). You can pick more than once.
      </p>
      {files.length > 0 && (
        <p className="bc-note" aria-label="Files picked">
          {files.map((f) => f.name).join(", ")}
        </p>
      )}
      <label className="bc-field-label" htmlFor={`${ids}licence`}>
        Its licence
      </label>
      <select id={`${ids}licence`} className="bc-select" value={licence} onChange={(e) => setLicence(e.target.value)}>
        {PROJECT_LICENCES.map((l) => (
          <option key={l}>{l}</option>
        ))}
      </select>
      {bad && (
        <p className="bc-note" role="alert">
          {bad}
        </p>
      )}
      {got && (
        <>
          <p role="status">{foundLine(got.found)}</p>
          {got.notes.length > 0 ? (
            <ul className="bc-ec-change-list" aria-label="What did not come across">
              {got.notes.slice(0, 60).map((x, i) => (
                <li key={i} className="bc-ec-warned">
                  {x.name}: {x.why}.
                </li>
              ))}
              {got.notes.length > 60 && <li className="bc-ec-warned">And {got.notes.length - 60} more.</li>}
            </ul>
          ) : (
            <p className="bc-note">Everything came across.</p>
          )}
          {replaces && <p className="bc-note">This takes the place of the schematic and board you have now. Undo brings them back.</p>}
        </>
      )}
    </Dialog>
  );
}
