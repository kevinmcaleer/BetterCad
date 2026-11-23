import { useId } from "react";
import { Button, Dialog } from "@bettercad/ui";
import type { FrameSymbol } from "@bettercad/kernel/drawing";
import { FRAME_SYMBOLS, NOTE_KINDS, noteKindName, type NoteDraft, type NoteKind } from "./notes";

/** A note tool is armed by its kind. Tools are named `note-…` so they sit beside the other drawing tools. */
export type NoteTool = `note-${NoteKind}`;
export const isNoteTool = (t: string | null | undefined): t is NoteTool => !!t && t.startsWith("note-") && NOTE_KINDS.some((k) => `note-${k.id}` === t);
export const noteKindOf = (t: NoteTool) => t.slice(5) as NoteKind;

export interface NoteCardProps {
  kind: NoteKind;
  /** Switch to another kind of note. Left out while a note is being changed. */
  onKind?: (kind: NoteKind) => void;
  draft: NoteDraft;
  onDraft: (draft: NoteDraft) => void;
  /** Changing a note that is already on the sheet: Done keeps it. */
  editing?: boolean;
  /** Puts loose text in the middle of the sheet, for the keyboard. */
  onPlace?: () => void;
  onDone: () => void;
  onCancel: () => void;
}

const HOW: Record<NoteKind, string> = {
  text: "Type the note, then click the sheet where it goes.",
  leader: "Type the note, then click the edge or hole it points at. Tab moves between them.",
  hole: "Click a hole. The note reads its size, depth and thread from the model.",
  finish: "Click the edge or face the finish is for.",
  datum: "Click the edge the datum is on.",
  frame: "Click the edge or hole the tolerance is for.",
};
const FIELD: Partial<Record<NoteKind, string>> = { text: "Text", leader: "Text", finish: "Roughness", datum: "Letter", frame: "Tolerance" };

/** The card of the note tools (#573): what kind of note, and what it says. Also used to change a note's words. */
export function NoteCard({ kind, onKind, draft, onDraft, editing, onPlace, onDone, onCancel }: NoteCardProps) {
  const id = useId();
  const long = kind === "text" || kind === "leader";
  return (
    <Dialog
      open
      title={editing ? `Change ${noteKindName(kind).toLowerCase()}` : noteKindName(kind)}
      icon="drawing"
      className="bc-view-card"
      width={300}
      onCancel={onCancel}
      onDone={onDone}
      doneLabel={editing ? "Done" : "Finish"}
    >
      <div className="bc-sheet-card">
        {onKind && (
          <>
            <label className="bc-field-label" htmlFor={`${id}-kind`}>
              Kind
            </label>
            <select id={`${id}-kind`} className="bc-select" value={kind} onChange={(e) => onKind(e.target.value as NoteKind)}>
              {NOTE_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </>
        )}
        {kind === "frame" && (
          <>
            <label className="bc-field-label" htmlFor={`${id}-symbol`}>
              Of
            </label>
            <select
              id={`${id}-symbol`}
              className="bc-select"
              value={draft.symbol}
              onChange={(e) => onDraft({ ...draft, symbol: e.target.value as FrameSymbol })}
            >
              {FRAME_SYMBOLS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </>
        )}
        {FIELD[kind] && (
          <>
            <label className="bc-field-label" htmlFor={`${id}-text`}>
              {FIELD[kind]}
            </label>
            {long ? (
              <textarea id={`${id}-text`} className="bc-text" rows={3} value={draft.text} onChange={(e) => onDraft({ ...draft, text: e.target.value })} />
            ) : (
              <input id={`${id}-text`} className="bc-text" value={draft.text} onChange={(e) => onDraft({ ...draft, text: e.target.value })} />
            )}
          </>
        )}
        {kind === "frame" && (
          <>
            <label className="bc-field-label" htmlFor={`${id}-datums`}>
              Datums
            </label>
            <input id={`${id}-datums`} className="bc-text" value={draft.datums} onChange={(e) => onDraft({ ...draft, datums: e.target.value })} />
          </>
        )}
        {!editing && (
          <p className="bc-note" role="status">
            {HOW[kind]}
          </p>
        )}
        {onPlace && (
          <span className="bc-view-card-place">
            <Button label="Put it in the middle" variant="secondary" disabled={!draft.text.trim()} onClick={onPlace} />
          </span>
        )}
      </div>
    </Dialog>
  );
}
