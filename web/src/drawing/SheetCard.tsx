import { Fragment, useEffect, useId, useRef, useState } from "react";
import { Button, Dialog } from "@bettercad/ui";
import {
  MAX_TITLE_FIELDS,
  SCALES,
  SHEET_SIZES,
  scaleLabel,
  standardFor,
  type Drawing,
  type DrawingSheet,
  type DrawingStandard,
  type SheetSize,
  type TitleBlock,
  type TitleField,
  type TitleLogo,
} from "@bettercad/kernel/drawing";
import { today } from "./layout";
import { rowsFor, type Rows } from "./arrange";
import { lastSheet, type SheetPick } from "./prefs";
import {
  MAX_TEMPLATES,
  carried,
  defaultTemplate,
  newTemplateId,
  readFields,
  readLogo,
  useTemplates,
  type DrawingTemplate,
  type TemplateApi,
} from "./templates";

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
  /** The logo and your own fields (#575): the drawing's, or for a new drawing its template's. */
  logo?: TitleLogo;
  fields?: TitleField[];
  /** A new drawing from a template: the title block fields it starts with. */
  block?: TitleBlock;
  /** A new drawing whose first sheet starts with a front view, the views beside it and an isometric. */
  views?: "four";
}

export interface SheetCardProps {
  /** The sheet being changed. Left out, the card sets up a new drawing, starting from the page you last used. */
  sheet?: DrawingSheet;
  /** The drawing that sheet is in, for its logo and your own fields. */
  drawing?: Drawing;
  /** The account's API and whether you are signed in, so templates follow you. Left out, they stay in this browser. */
  api?: TemplateApi;
  signedIn?: boolean;
  /** Turns a picked file into a logo; the browser's own way unless a test gives another. */
  logoOf?: (file: Blob) => Promise<TitleLogo>;
  onCancel: () => void;
  onDone: (choice: SheetChoice) => void;
}

/**
 * Sheet set-up (#560): the page size, which way up, the standard and the border. It opens on New drawing, and again
 * from Sheet settings, where the title block's fields (#567) are listed too for keyboards and screen readers.
 * Templates (#575): New drawing starts from one, and Sheet settings saves the sheet as it is set up as one.
 */
export default function SheetCard({ sheet, drawing, api, signedIn, logoOf = readLogo, onCancel, onDone }: SheetCardProps) {
  const id = useId();
  const { templates, save, remove, setDefault } = useTemplates(api, signedIn);
  // A new drawing starts from your default template, or the page you last used.
  const [start] = useState(() => (sheet ? undefined : defaultTemplate(templates)));
  const [last] = useState(lastSheet);
  const [templateId, setTemplateId] = useState(start?.id ?? "");
  const template = sheet ? undefined : templates.find((t) => t.id === templateId);
  const [size, setSize] = useState<SheetSize>(sheet?.size ?? start?.size ?? last.size);
  const [landscape, setLandscape] = useState(sheet?.landscape ?? start?.landscape ?? last.landscape);
  // The standard follows the page size until you pick one yourself.
  const [standard, setStandard] = useState<DrawingStandard | undefined>(sheet ? sheet.standard : start ? start.standard : last.standard);
  const [border, setBorder] = useState(sheet?.border ?? start?.border ?? last.border);
  const [views, setViews] = useState<"none" | "four">(start?.views ?? "none");
  const [logo, setLogo] = useState<TitleLogo | undefined>(drawing?.logo);
  const [fields, setFields] = useState<TitleField[]>(drawing?.fields ?? []);
  const [name, setName] = useState("");
  const [withViews, setWithViews] = useState(false);
  const [note, setNote] = useState("");
  const file = useRef<HTMLInputElement>(null);
  // Whether a template has been picked, by you or as your default.
  const picked = useRef(!!start);
  const pickTemplate = (t: DrawingTemplate | undefined) => {
    picked.current = true;
    setTemplateId(t?.id ?? "");
    if (!t) return setViews("none");
    setSize(t.size);
    setLandscape(t.landscape);
    setStandard(t.standard);
    setBorder(t.border);
    setViews(t.views);
  };
  // On a machine that is new to your account the templates arrive after the card opens: your default still starts it.
  useEffect(() => {
    const first = sheet || picked.current ? undefined : defaultTemplate(templates);
    if (first) pickTemplate(first);
  }, [sheet, templates]);
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
      if (logo) choice.logo = logo;
      const own = readFields(fields);
      if (own.length) choice.fields = own;
    } else {
      if (template) {
        choice.block = template.title;
        if (template.logo) choice.logo = template.logo;
        if (template.fields) choice.fields = template.fields;
      }
      if (views === "four") choice.views = "four";
    }
    onDone(choice);
  };
  const chooseLogo = async (picked: File | undefined) => {
    if (!picked) return;
    try {
      setLogo(await logoOf(picked));
      setNote("");
    } catch {
      setNote("That file isn't a picture BetterCad can read. Try a PNG or a JPEG.");
    }
  };
  const ownField = (i: number, change: Partial<TitleField>) => setFields((all) => all.map((f, k) => (k === i ? { ...f, ...change } : f)));
  const saveTemplate = () => {
    const t: DrawingTemplate = {
      id: newTemplateId(),
      name: name.trim(),
      size,
      landscape,
      standard: shown,
      border,
      title: carried(title),
      views: withViews ? "four" : "none",
    };
    if (logo) t.logo = logo;
    const own = readFields(fields);
    if (own.length) t.fields = own;
    // Saving over a template of the same name keeps it the default if it was.
    if (templates.find((x) => x.name.toLowerCase() === t.name.toLowerCase())?.default) t.default = true;
    setNote(
      save(t)
        ? `Saved as ${t.name}. Pick it under Template when you make a new drawing.`
        : `You can keep up to ${MAX_TEMPLATES} templates. Delete one to add another.`,
    );
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
        {!sheet && templates.length > 0 && (
          <>
            <label className="bc-field-label" htmlFor={`${id}-template`}>
              Template
            </label>
            <select
              id={`${id}-template`}
              className="bc-select"
              value={template?.id ?? ""}
              onChange={(e) => pickTemplate(templates.find((t) => t.id === e.target.value))}
            >
              <option value="">None</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {template && (
              <span className="bc-sheet-card-row">
                <label className="bc-check">
                  <input type="checkbox" checked={!!template.default} onChange={(e) => setDefault(e.target.checked ? template.id : null)} />
                  <span>Start new drawings from this</span>
                </label>
                <Button
                  label="Delete template"
                  variant="secondary"
                  onClick={() => {
                    remove(template.id);
                    pickTemplate(undefined);
                  }}
                />
              </span>
            )}
          </>
        )}
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

        {!sheet && (
          <>
            <label className="bc-field-label" htmlFor={`${id}-views`}>
              First views
            </label>
            <select id={`${id}-views`} className="bc-select" value={views} onChange={(e) => setViews(e.target.value as "none" | "four")}>
              <option value="none">None</option>
              <option value="four">Front, top, side and isometric</option>
            </select>
          </>
        )}

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

            <span className="bc-field-label" id={`${id}-logo`}>
              Logo
            </span>
            <span className="bc-sheet-card-date" role="group" aria-labelledby={`${id}-logo`}>
              {logo && <img className="bc-sheet-card-logo" src={logo.data} alt="The logo in the title block" />}
              <Button label={logo ? "Change picture" : "Choose a picture"} variant="secondary" onClick={() => file.current?.click()} />
              {logo && <Button label="Remove logo" variant="secondary" onClick={() => setLogo(undefined)} />}
              <input
                ref={file}
                type="file"
                accept="image/*"
                hidden
                aria-label="Logo picture"
                onChange={(e) => {
                  void chooseLogo(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </span>

            <h3 className="bc-sheet-card-head">Your own fields</h3>
            {fields.map((f, i) => (
              <span key={i} className="bc-sheet-card-own">
                <input
                  className="bc-text"
                  aria-label={`Field ${i + 1} name`}
                  placeholder="Name"
                  maxLength={40}
                  value={f.label}
                  onChange={(e) => ownField(i, { label: e.target.value })}
                />
                <input
                  className="bc-text"
                  aria-label={`Field ${i + 1} value`}
                  placeholder="Value"
                  maxLength={80}
                  value={f.value}
                  onChange={(e) => ownField(i, { value: e.target.value })}
                />
                <Button icon="trash" title={`Remove field ${i + 1}`} onClick={() => setFields((all) => all.filter((_, k) => k !== i))} />
              </span>
            ))}
            <span className="bc-sheet-card-row">
              <Button
                label="Add a field"
                variant="secondary"
                disabled={fields.length >= MAX_TITLE_FIELDS}
                onClick={() => setFields((all) => [...all, { label: "", value: "" }])}
              />
            </span>
            <p className="bc-note">Material, Finish, Project: they sit in a row above the title block, with the logo.</p>

            <h3 className="bc-sheet-card-head">Save as a template</h3>
            <label className="bc-field-label" htmlFor={`${id}-name`}>
              Template name
            </label>
            <input id={`${id}-name`} className="bc-text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            <label className="bc-check">
              <input type="checkbox" checked={withViews} onChange={(e) => setWithViews(e.target.checked)} />
              <span>Start with front, top, side and isometric views</span>
            </label>
            <span className="bc-sheet-card-row">
              <Button label="Save template" variant="secondary" disabled={!name.trim()} onClick={saveTemplate} />
            </span>
            <p className="bc-note" role="status">
              {note || (signedIn ? "Templates are kept in your account." : "Templates are kept in this browser. Sign in to keep them in your account.")}
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
