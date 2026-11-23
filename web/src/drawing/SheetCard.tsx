import { Fragment, useId, useState } from "react";
import { Button, Dialog } from "@bettercad/ui";
import {
  SCALES,
  SHEET_SIZES,
  scaleLabel,
  standardFor,
  type DrawingSheet,
  type DrawingStandard,
  type SheetSize,
  type TitleBlock,
} from "@bettercad/kernel/drawing";
import { today } from "./layout";
import { rowsFor, type Rows } from "./arrange";
import { lastSheet, type SheetPick } from "./prefs";

const SIZES = Object.keys(SHEET_SIZES) as SheetSize[];
const mm = (v: number) => String(Math.round(v * 10) / 10);
const sizeText = (s: SheetSize) => `${SHEET_SIZES[s].label}, ${mm(SHEET_SIZES[s].w)} × ${mm(SHEET_SIZES[s].h)} mm`;

/** The title block's fields you type into, in the order they are listed. */
const FIELDS: [keyof TitleBlock, string][] = [
  ["title", "Title"],
  ["number", "Drawing number"],
  ["revision", "Revision"],
  ["author", "Created by"],
  ["approved", "Approved by"],
  ["type", "Document type"],
  ["status", "Document status"],
];

/** What the card hands back: the page, and for a sheet that exists its scale and title block too. */
export interface SheetChoice extends SheetPick {
  standard: DrawingStandard;
  scale?: number;
  title?: TitleBlock;
  /** Where rows of dimensions sit (#565); left out when they are the standard's. */
  rows?: Rows;
}

export interface SheetCardProps {
  /** The sheet being changed. Left out, the card sets up a new drawing, starting from the page you last used. */
  sheet?: DrawingSheet;
  onCancel: () => void;
  onDone: (choice: SheetChoice) => void;
}

/**
 * Sheet set-up (#560): the page size, which way up, the standard and the border. It opens on New drawing, and again
 * from Sheet settings, where the title block's fields (#567) are listed too for keyboards and screen readers.
 */
export function SheetCard({ sheet, onCancel, onDone }: SheetCardProps) {
  const [start] = useState(lastSheet);
  const id = useId();
  const [size, setSize] = useState<SheetSize>(sheet?.size ?? start.size);
  const [landscape, setLandscape] = useState(sheet?.landscape ?? start.landscape);
  // The standard follows the page size until you pick one yourself.
  const [standard, setStandard] = useState<DrawingStandard | undefined>(sheet ? sheet.standard : start.standard);
  const [border, setBorder] = useState(sheet?.border ?? start.border);
  const [scale, setScale] = useState(sheet?.scale ?? 1);
  const [title, setTitle] = useState<TitleBlock>(sheet?.title ?? {});
  const shown = standard ?? standardFor(size);
  // Rows of dimensions follow the standard until you set them yourself.
  const [rows, setRows] = useState<Rows | undefined>(sheet?.rows);
  const rowsNow = rows ?? rowsFor(shown);

  const done = () => {
    const choice: SheetChoice = { size, landscape, border, standard: shown };
    if (sheet) {
      choice.scale = scale;
      // Blank fields are left out of the file.
      choice.title = Object.fromEntries(Object.entries(title).filter(([, v]) => v?.trim())) as TitleBlock;
      const usual = rowsFor(shown);
      if (rows && (rows.first !== usual.first || rows.next !== usual.next)) choice.rows = rows;
    }
    onDone(choice);
  };
  const field = (key: keyof TitleBlock, value: string) => setTitle((t) => ({ ...t, [key]: value }));

  return (
    <Dialog
      open
      modal
      title={sheet ? "Sheet settings" : "New drawing"}
      icon="drawing"
      onCancel={onCancel}
      onDone={done}
      doneLabel={sheet ? "Done" : "Create"}
      width={360}
    >
      <div className="bc-sheet-card">
        <label className="bc-field-label" htmlFor={`${id}-size`}>
          Page size
        </label>
        <select id={`${id}-size`} className="bc-select" value={size} onChange={(e) => setSize(e.target.value as SheetSize)}>
          <optgroup label="A sizes">
            {SIZES.filter((s) => SHEET_SIZES[s].family === "iso").map((s) => (
              <option key={s} value={s}>
                {sizeText(s)}
              </option>
            ))}
          </optgroup>
          <optgroup label="US sizes">
            {SIZES.filter((s) => SHEET_SIZES[s].family === "us").map((s) => (
              <option key={s} value={s}>
                {sizeText(s)}
              </option>
            ))}
          </optgroup>
        </select>

        <span className="bc-field-label" id={`${id}-way`}>
          Orientation
        </span>
        <span role="group" aria-labelledby={`${id}-way`} className="bc-segmented">
          <Button label="Landscape" on={landscape} onClick={() => setLandscape(true)} />
          <Button label="Portrait" on={!landscape} onClick={() => setLandscape(false)} />
        </span>

        <label className="bc-field-label" htmlFor={`${id}-standard`}>
          Standard
        </label>
        <select id={`${id}-standard`} className="bc-select" value={shown} onChange={(e) => setStandard(e.target.value as DrawingStandard)}>
          <option value="iso">ISO, first angle</option>
          <option value="asme">ASME, third angle</option>
        </select>
        <p className="bc-note">A sizes start as ISO and US sizes as ASME. Sizes on the drawing are in mm either way.</p>

        <label className="bc-check">
          <input type="checkbox" checked={border} onChange={(e) => setBorder(e.target.checked)} />
          <span>Border and zones</span>
        </label>

        {sheet && (
          <>
            <label className="bc-field-label" htmlFor={`${id}-scale`}>
              Scale
            </label>
            <select id={`${id}-scale`} className="bc-select" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
              {(SCALES as readonly number[]).includes(scale) ? null : <option value={scale}>{scaleLabel(scale)}</option>}
              {[...SCALES].reverse().map((s) => (
                <option key={s} value={s}>
                  {scaleLabel(s)}
                </option>
              ))}
            </select>

            <h3 className="bc-sheet-card-head">Rows of dimensions</h3>
            <label className="bc-field-label" htmlFor={`${id}-first`}>
              First row from the view
            </label>
            <select id={`${id}-first`} className="bc-select" value={rowsNow.first} onChange={(e) => setRows({ ...rowsNow, first: Number(e.target.value) })}>
              {[...new Set([6, 8, 10, 12, 15, rowsNow.first])]
                .sort((a, b) => a - b)
                .map((mm) => (
                  <option key={mm} value={mm}>{`${mm} mm`}</option>
                ))}
            </select>
            <label className="bc-field-label" htmlFor={`${id}-next`}>
              Between rows
            </label>
            <select id={`${id}-next`} className="bc-select" value={rowsNow.next} onChange={(e) => setRows({ ...rowsNow, next: Number(e.target.value) })}>
              {[...new Set([6, 7, 8, 10, 12, rowsNow.next])]
                .sort((a, b) => a - b)
                .map((mm) => (
                  <option key={mm} value={mm}>{`${mm} mm`}</option>
                ))}
            </select>

            <h3 className="bc-sheet-card-head">Title block</h3>
            {FIELDS.map(([key, label]) => (
              <Fragment key={key}>
                <label className="bc-field-label" htmlFor={`${id}-${key}`}>
                  {label}
                </label>
                <input id={`${id}-${key}`} className="bc-text" value={title[key] ?? ""} onChange={(e) => field(key, e.target.value)} />
              </Fragment>
            ))}
            <label className="bc-field-label" htmlFor={`${id}-date`}>
              Date of issue
            </label>
            <span className="bc-sheet-card-date">
              <input id={`${id}-date`} className="bc-text" type="date" value={title.date ?? ""} onChange={(e) => field("date", e.target.value)} />
              <Button label="Set to today" variant="secondary" onClick={() => field("date", today())} />
            </span>
          </>
        )}
      </div>
    </Dialog>
  );
}
