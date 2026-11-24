import type { ModelDoc } from "./document";
import { newId } from "./document";
import type { ModelViewRequest, V2, V3, ViewCut, ViewFrame } from "./view";
import { VIEWS } from "./view";

/**
 * Drawings (#555, #557): 2D sheets made from the model and saved with it. Only what the person chose is kept: the
 * sheet, where each view sits and what it shows, the marks and the dimensions. The lines of a view are worked out
 * from the model each time (`projectView`), as bodies are, so a drawing is never out of date.
 *
 * Drawings read the model and never change it, so they are not timeline steps. Everything on a sheet is in paper
 * millimetres from the sheet's bottom left corner, x to the right and y up.
 */

/** Page sizes, short side by long side, mm. US sizes keep their inch names; everything is still millimetres. */
export const SHEET_SIZES = {
  A4: { w: 210, h: 297, family: "iso", label: "A4" },
  A3: { w: 297, h: 420, family: "iso", label: "A3" },
  A2: { w: 420, h: 594, family: "iso", label: "A2" },
  A1: { w: 594, h: 841, family: "iso", label: "A1" },
  A0: { w: 841, h: 1189, family: "iso", label: "A0" },
  letter: { w: 215.9, h: 279.4, family: "us", label: "Letter (ANSI A)" },
  legal: { w: 215.9, h: 355.6, family: "us", label: "Legal" },
  tabloid: { w: 279.4, h: 431.8, family: "us", label: "Tabloid (ANSI B)" },
  ansiC: { w: 431.8, h: 558.8, family: "us", label: "ANSI C" },
  ansiD: { w: 558.8, h: 863.6, family: "us", label: "ANSI D" },
  ansiE: { w: 863.6, h: 1117.6, family: "us", label: "ANSI E" },
} as const satisfies Record<string, { w: number; h: number; family: "iso" | "us"; label: string }>;
export type SheetSize = keyof typeof SHEET_SIZES;

/**
 * The drawing standard. It sets the projection (ISO: first angle, ASME: third angle), the title block's layout and
 * how dimensions are drawn.
 */
export type DrawingStandard = "iso" | "asme";

/** The standard a new sheet starts with: it follows the page size (Kev, 2026-11-22). Either can be switched after. */
export const standardFor = (size: SheetSize): DrawingStandard => (SHEET_SIZES[size].family === "iso" ? "iso" : "asme");

/** A named view direction, or the camera the model was left with. */
export type ViewDirection = keyof typeof VIEWS | { toEye: V3; up: V3 };

export const frameOf = (d: ViewDirection): ViewFrame => (typeof d === "string" ? VIEWS[d] : d);

/** What a view shows: the whole model, one component with everything in it, or picked bodies. Hidden bodies stay out. */
export type ViewShows = ModelViewRequest["shows"];

export interface DrawingView {
  id: string;
  /**
   * `section` (#571): the model cut on a plane, seen from the side taken away. `detail`: a circle of its parent,
   * larger. Both are lettered, and marked on the parent.
   */
  kind: "base" | "projected" | "section" | "detail";
  /**
   * The view this one was taken from. A projected or section view stays lined up with it, and takes its scale and
   * style unless it has its own.
   */
  parent?: string;
  /** A section view's cut, in the model's own millimetres, and its letter. A detail of a section view has it too. */
  section?: ViewCut & { label: string };
  /** A detail view's circle, in its parent's view millimetres, and its letter. */
  detail?: { c: V2; r: number; label: string };
  /**
   * Breaks: stretches of a long part left out, in the view's millimetres. `x` takes a band out across the sheet,
   * `y` one up it. What is past a break is drawn closer; dimensions still read the true size.
   */
  breaks?: { axis: "x" | "y"; from: number; to: number }[];
  shows: ViewShows;
  direction: ViewDirection;
  /** Paper size over real size (0.5 is 1:2). Missing: the parent's, or the sheet's. */
  scale?: number;
  /** Draw hidden edges, dashed. */
  hidden: boolean;
  /** Draw tangent edges, where a fillet meets a flat. */
  tangent: boolean;
  /** Where the middle of the view's box sits on the sheet. */
  at: V2;
  /**
   * The view as its marks and dimensions were last laid out (#568): its size on paper and what each dimension read.
   * When the model changes these, the rows are stacked again.
   */
  laid?: { w: number; h: number; sizes: string };
}

/**
 * What a mark or dimension is fixed to: an edge or face of a body as a view shows it, by its name (#47) so it holds
 * when the model changes, with its number as it was for when names run out (big imports). `at` picks a point on it.
 */
export interface DrawingRef {
  view: string;
  body: string;
  kind: "edge" | "face";
  name?: string;
  index: number;
  at?: "start" | "end" | "middle" | "centre";
}

export type DrawingMark = (
  | /** A cross at the centre of a circle or arc. */ { id: string; kind: "centre-mark"; on: DrawingRef }
    /** Centre marks on a set of holes, with the pitch circle or the lines that join them. */
  | { id: string; kind: "centre-pattern"; on: DrawingRef[]; join: "circle" | "lines" }
  /** The line midway between two edges, or the axis of one round face seen from the side. */
  | { id: string; kind: "centre-line"; a: DrawingRef; b?: DrawingRef }
  /** Two edges carried on to where they would meet. */
  | { id: string; kind: "extension"; a: DrawingRef; b: DrawingRef }
) & {
  /** Where it was last drawn, from the middle of its view in paper mm: where its warning goes when it is lost (#568). */
  was?: V2;
};

export interface DrawingDimension {
  id: string;
  view: string;
  kind: "linear" | "angle" | "radius" | "diameter";
  /** One ref (an edge's length, a circle's size) or two (between them). */
  refs: DrawingRef[];
  /** For a linear size: measured across the sheet, up it, or straight between the two points. */
  across?: "x" | "y" | "aligned";
  /** Where the text sits, from the middle of its view's box, in paper mm. */
  at: V2;
  /** Added by Auto dimension, so running it again replaces this one. Cleared when the person moves or edits it. */
  auto?: boolean;
  /** Decimal places, when not the drawing's. */
  decimals?: number;
  /** A tolerance written after the size (#573). */
  tolerance?: DimTolerance;
}

/**
 * How far a size may be off. `plus` and `minus` are both given as positive millimetres (or degrees): equal, they are
 * written "±0.1", unequal "+0.2/-0.1", and as `limits` the largest and smallest sizes are written out instead. A
 * `fit` is one of the printer's named fits (`docs/fits.md`), written with the gap each side it had when it was chosen
 * (as a fitted cut keeps its gap, #183).
 */
export type DimTolerance = { plus: number; minus: number; limits?: boolean } | { fit: "press" | "sliding" | "loose"; gap: number };

/** What a feature control frame says of a face or edge. */
export type FrameSymbol = "position" | "flatness" | "perpendicular" | "parallel" | "circular" | "straight" | "concentric";

/**
 * A note on a sheet (#573). `text` is free writing; `leader` the same with an arrow to an edge or hole; `hole` reads
 * the hole it points at from the model each time; `finish` is a surface finish mark, `datum` a datum letter and
 * `frame` a feature control frame, each on the edge or hole it is about. A `balloon` (#574) is a part's item number
 * in a circle, read from the parts list each time.
 */
export interface DrawingNote {
  id: string;
  kind: "text" | "leader" | "hole" | "finish" | "datum" | "frame" | "balloon";
  /**
   * What it says, lines parted by "\n". A hole note's is left empty: it is read from the model. A finish's is its
   * roughness ("Ra 3.2"), a datum's its letter, and a frame's its tolerance then its datums, parted by "|".
   */
  text: string;
  /** A frame's characteristic. */
  symbol?: FrameSymbol;
  /** What it points at. Left out, the note is loose on the sheet. */
  on?: DrawingRef;
  /** Where its text starts: from the middle of the view it points into, or (loose) from the sheet's bottom left. */
  at: V2;
}

/** The document information box, bottom right. Missing fields show blank. */
export interface TitleBlock {
  title?: string;
  author?: string;
  /** Date of issue, ISO (2026-11-22); shown the way the standard writes it. */
  date?: string;
  number?: string;
  revision?: string;
  approved?: string;
  type?: string;
  status?: string;
}

/** A picture in the title block (#575): a JPEG as a data URL, small enough to travel in the file, and its size in pixels. */
export interface TitleLogo {
  data: string;
  w: number;
  h: number;
}
/** A title block field of your own (#575): what it is called and what it says. */
export interface TitleField {
  label: string;
  value: string;
}
/** How many fields of your own a title block holds. */
export const MAX_TITLE_FIELDS = 8;

export type AutoRecipe = "baseline" | "chain" | "centre-baseline" | "centre-chain";
export type DatumCorner = "bottom-left" | "bottom-right" | "top-left" | "top-right" | "centre";

export interface DrawingSheet {
  id: string;
  name: string;
  size: SheetSize;
  landscape: boolean;
  standard: DrawingStandard;
  /** Frame, zone grid and centring marks. */
  border: boolean;
  /** The sheet's scale: what views use unless they have their own, and what the title block shows. */
  scale: number;
  title: TitleBlock;
  views: DrawingView[];
  marks: DrawingMark[];
  dimensions: DrawingDimension[];
  /**
   * Where rows of dimensions sit, mm on paper: the first row this far from a view's outline and each further row
   * this much further out (#565). Left out, the standard's own spacing.
   */
  rows?: { first: number; next: number };
  /** Text, leaders, hole notes and symbols (#573). */
  notes?: DrawingNote[];
  /** A parts list above the title block (#574): the model's components and loose bodies, counted each time it is drawn. */
  partsList?: boolean;
  /** What Auto dimension was last run with, so Run again does the same. `density` is 0 (fewest) to 1 (all). */
  auto?: { recipe: AutoRecipe; datum: DatumCorner; density: number };
}

export interface Drawing {
  id: string;
  name: string;
  /** One sheet in release 1; the list is here for more (#572). */
  sheets: DrawingSheet[];
  /** Decimal places on dimensions (0 to 3). */
  decimals: number;
  /** A logo in the title block of every sheet (#575). */
  logo?: TitleLogo;
  /** Fields of your own, in a row above the title block's (#575). */
  fields?: TitleField[];
}

/** A sheet's width and height on screen and paper, mm. */
export function sheetBox(sheet: Pick<DrawingSheet, "size" | "landscape">): { w: number; h: number } {
  const { w, h } = SHEET_SIZES[sheet.size];
  return sheet.landscape ? { w: h, h: w } : { w, h };
}

/** Standard scales, smallest first: reductions for big parts, enlargements for small ones. */
export const SCALES = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50] as const;

/** "1:2", "5:1", or "0.3:1" for a scale that isn't a standard one. */
export function scaleLabel(scale: number): string {
  const n = (v: number) => String(Math.round(v * 100) / 100);
  return scale >= 1 ? `${n(scale)}:1` : Number.isInteger(Math.round((1 / scale) * 100) / 100) ? `1:${n(1 / scale)}` : `${n(scale)}:1`;
}

/** The largest standard scale at which a box of real millimetres fits a space of paper millimetres. */
export function fitScale(real: { w: number; h: number }, space: { w: number; h: number }): number {
  const most = Math.min(space.w / (real.w || 1), space.h / (real.h || 1));
  return [...SCALES].reverse().find((s) => s <= most + 1e-9) ?? SCALES[0];
}

export interface NewDrawing {
  size?: SheetSize;
  landscape?: boolean;
  standard?: DrawingStandard;
  border?: boolean;
  /** Who is signed in, for the title block. */
  author?: string;
  /** Today, ISO, for the title block. */
  date?: string;
  /** Title block fields to start from (#575): a template's. The title, author and date above still win. */
  block?: TitleBlock;
  logo?: TitleLogo;
  fields?: TitleField[];
}

/** A sheet with nothing on it. The standard follows the page size unless one is given. */
export function newSheet(name: string, o: NewDrawing & { title?: string } = {}): DrawingSheet {
  const size = o.size ?? "A4";
  const title: TitleBlock = { revision: "A", type: "Part drawing", ...o.block };
  if (o.title) title.title = o.title;
  if (o.author) title.author = o.author;
  if (o.date) title.date = o.date;
  return {
    id: newId("sh"),
    name,
    size,
    landscape: o.landscape ?? true,
    standard: o.standard ?? standardFor(size),
    border: o.border ?? true,
    scale: 1,
    title,
    views: [],
    marks: [],
    dimensions: [],
  };
}

/** The next free "Drawing N". */
const nextName = (doc: ModelDoc) => {
  const used = new Set((doc.drawings ?? []).map((d) => d.name));
  for (let i = 1; ; i++) if (!used.has(`Drawing ${i}`)) return `Drawing ${i}`;
};

/** Adds a drawing with one empty sheet, titled with the model's name. */
export function addDrawing(doc: ModelDoc, o: NewDrawing = {}): { doc: ModelDoc; id: string } {
  const drawing: Drawing = { id: newId("dr"), name: nextName(doc), sheets: [newSheet("Sheet 1", { ...o, title: doc.name })], decimals: 2 };
  if (o.logo) drawing.logo = o.logo;
  if (o.fields?.length) drawing.fields = o.fields;
  return { doc: { ...doc, drawings: [...(doc.drawings ?? []), drawing] }, id: drawing.id };
}

export function removeDrawing(doc: ModelDoc, id: string): ModelDoc {
  const drawings = (doc.drawings ?? []).filter((d) => d.id !== id);
  const next: ModelDoc = { ...doc, drawings };
  if (!drawings.length) delete next.drawings;
  return next;
}

export function renameDrawing(doc: ModelDoc, id: string, name: string): ModelDoc {
  const n = name.trim();
  return n ? changeDrawing(doc, id, (d) => ({ ...d, name: n })) : doc;
}

/** Changes one drawing. The same document comes back when there is no such drawing or nothing changed. */
export function changeDrawing(doc: ModelDoc, id: string, fn: (d: Drawing) => Drawing): ModelDoc {
  let changed = false;
  const drawings = (doc.drawings ?? []).map((d) => {
    if (d.id !== id) return d;
    const next = fn(d);
    changed ||= next !== d;
    return next;
  });
  return changed ? { ...doc, drawings } : doc;
}

/** Changes one sheet of a drawing. */
export function changeSheet(doc: ModelDoc, drawing: string, sheet: string, fn: (s: DrawingSheet) => DrawingSheet): ModelDoc {
  return changeDrawing(doc, drawing, (d) => {
    const at = d.sheets.findIndex((s) => s.id === sheet);
    if (at < 0) return d;
    const next = fn(d.sheets[at]!);
    return next === d.sheets[at] ? d : { ...d, sheets: d.sheets.map((s, i) => (i === at ? next : s)) };
  });
}

/** A view's scale: its own, else its parent's, else the sheet's. */
export function viewScale(sheet: DrawingSheet, view: DrawingView): number {
  const seen = new Set<string>();
  for (let v: DrawingView | undefined = view; v && !seen.has(v.id); v = sheet.views.find((x) => x.id === v!.parent)) {
    if (v.scale) return v.scale;
    seen.add(v.id);
  }
  return sheet.scale;
}

/**
 * Takes a view off a sheet, with the marks and dimensions fixed to it. Its projected views stay, as base views (they
 * keep the scale they had), and so do its sections and details.
 */
export function removeView(sheet: DrawingSheet, id: string): DrawingSheet {
  const gone = sheet.views.find((v) => v.id === id);
  if (!gone) return sheet;
  const on = (r: DrawingRef) => r.view === id;
  return {
    ...sheet,
    views: sheet.views
      .filter((v) => v.id !== id)
      .map((v) => {
        if (v.parent !== id) return v;
        // A section or detail is still one without the view it was taken from; it is only no longer marked there.
        const base: DrawingView = { ...v, kind: v.kind === "projected" ? "base" : v.kind, scale: v.scale ?? viewScale(sheet, gone) };
        delete base.parent;
        return base;
      }),
    marks: sheet.marks.filter((m) => !(m.kind === "centre-pattern" ? m.on.some(on) : m.kind === "centre-mark" ? on(m.on) : on(m.a) || (m.b ? on(m.b) : false))),
    dimensions: sheet.dimensions.filter((d) => d.view !== id),
    ...(sheet.notes ? { notes: sheet.notes.filter((n) => n.on?.view !== id) } : {}),
  };
}
