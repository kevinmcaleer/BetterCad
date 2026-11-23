import {
  MAX_TITLE_FIELDS,
  SHEET_SIZES,
  scaleLabel,
  sheetBox,
  type DrawingSheet,
  type TitleBlock,
  type TitleField,
  type TitleLogo,
} from "@bettercad/kernel/drawing";

/**
 * Where everything printed round a drawing goes: the frame, the zone grid, the centring marks and the title block
 * (#560, #567). Millimetres on the page, from its top left corner with y down, as SVG draws it. Nothing here touches
 * the DOM, so the screen, the tests and export (#569) all lay a sheet out the same way.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Stroke {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface ZoneLabel {
  text: string;
  x: number;
  y: number;
}
export type TitleKey = keyof TitleBlock | "scale" | "size" | "sheet" | "units" | "projection";
export interface TitleCell extends Box {
  /** A field of your own is `field-0`, `field-1`…; the logo's cell is `logo` (#575). */
  key: TitleKey | "logo" | `field-${number}`;
  label: string;
  /** What the cell shows; the projection cell shows its symbol instead. */
  value: string;
  /** The value's letter height, shrunk until a long value fits its cell. */
  size: number;
  /** The title block field you type into; the rest are worked out for you. */
  edit?: keyof TitleBlock;
  /** The logo's cell: its picture, and where it sits in the cell at its own shape. */
  image?: { logo: TitleLogo; box: Box };
}
export interface SheetLayout {
  page: { w: number; h: number };
  /** The drawing frame. With the border off nothing is drawn round it, but views and the title block still keep to it. */
  frame: Box;
  border: boolean;
  /** Zone ticks, in the strip just outside the frame. */
  ticks: Stroke[];
  labels: ZoneLabel[];
  /** The four marks at the middle of each side, for lining a print up. */
  centring: Stroke[];
  /** The title block, in the frame's bottom right corner. */
  block: Box;
  cells: TitleCell[];
  /** First angle (ISO) or third angle (ASME), for the symbol in the title block. */
  angle: "first" | "third";
}

/** Zone strip width, and how far the frame sits from the page edge on each standard. */
export const STRIP = 5;
/** ISO 5457: 20 mm on the left for filing, 10 mm elsewhere. ASME sheets: half an inch all round. */
export const margins = (standard: DrawingSheet["standard"]) =>
  standard === "iso" ? { left: 20, right: 10, top: 10, bottom: 10 } : { left: 12.7, right: 12.7, top: 12.7, bottom: 12.7 };

/** Letter heights on paper, mm. */
export const TEXT = { label: 1.8, value: 3.5, title: 5, zone: 3.5 } as const;
/** Line widths on paper, mm: the frame and title block's outline, and the thin lines inside. */
export const WEIGHT = { thick: 0.7, thin: 0.25 } as const;

/** Zone letters skip I and O, which read as 1 and 0. */
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** An even number of zones about 50 mm long, so the centring mark falls between two. */
const zones = (length: number) => Math.max(2, Math.round(length / 100) * 2);

/** A sheet size's short name for the title block: "A3", "Letter", "C". */
export const sizeName = (size: DrawingSheet["size"]) => SHEET_SIZES[size].label.replace(/ \(.*/, "").replace(/^ANSI /, "");

const LABELS: Record<DrawingSheet["standard"], Record<TitleKey, string>> = {
  iso: {
    author: "Created by",
    approved: "Approved by",
    type: "Document type",
    status: "Document status",
    title: "Title",
    number: "Drawing number",
    revision: "Rev",
    date: "Date of issue",
    scale: "Scale",
    size: "Size",
    projection: "Projection",
    units: "Units",
    sheet: "Sheet",
  },
  asme: {
    author: "Drawn",
    approved: "Approved",
    type: "Type",
    status: "Status",
    title: "Title",
    number: "Drawing number",
    revision: "Rev",
    date: "Date",
    scale: "Scale",
    size: "Size",
    projection: "Projection",
    units: "Units",
    sheet: "Sheet",
  },
};

/** Rows of cells, top to bottom: [key, width]. A cell that spans two rows is given with the row it starts in. */
type Row = { h: number; cells: [TitleKey, number, number?][] };
/** ISO 7200: 180 mm wide, the title and number biggest, who and when along the top. */
const ISO_ROWS: Row[] = [
  {
    h: 12,
    cells: [
      ["author", 45],
      ["approved", 45],
      ["type", 50],
      ["status", 40],
    ],
  },
  {
    h: 12,
    cells: [
      ["title", 90, 2],
      ["number", 50],
      ["revision", 15],
      ["date", 25],
    ],
  },
  {
    h: 12,
    cells: [
      ["scale", 20],
      ["size", 15],
      ["projection", 20],
      ["units", 15],
      ["sheet", 20],
    ],
  },
];
/** ASME: the title across the block, with size, number and revision in the bottom row. */
const ASME_ROWS: Row[] = [
  {
    h: 12,
    cells: [
      ["author", 40],
      ["date", 30],
      ["approved", 40],
      ["type", 25],
      ["status", 25],
    ],
  },
  { h: 14, cells: [["title", 160]] },
  {
    h: 12,
    cells: [
      ["size", 20],
      ["number", 55],
      ["revision", 15],
      ["scale", 22],
      ["units", 14],
      ["projection", 19],
      ["sheet", 15],
    ],
  },
];

const EDITABLE: ReadonlySet<TitleKey> = new Set<TitleKey>(["author", "approved", "type", "status", "title", "number", "revision", "date"]);

/** Roughly how wide a run of text is, in letter heights: enough to shrink a long title into its cell. */
const widthOf = (text: string, size: number) => text.length * size * 0.62;

export interface SheetInfo {
  /** This sheet's place in its drawing, from 1, and how many sheets there are. */
  index?: number;
  count?: number;
  /** The drawing's logo and fields of its own (#575), in rows above the standard's. */
  logo?: TitleLogo;
  fields?: readonly TitleField[];
}

/** A long value's letter height, shrunk until it fits a cell this wide. */
const fitted = (value: string, w: number, size: number) =>
  widthOf(value, size) > w - 3 ? Math.max(TEXT.label, Math.floor(((w - 3) / (value.length * 0.62)) * 10) / 10) : size;

/** Cells to a row of your own fields, and how tall a row is with and without the logo in it. */
const OWN = { across: 4, h: 12, logo: 16 } as const;

/** The fields that are shown: those with a name or something to say, up to the most a block holds. */
export const shownFields = (fields: readonly TitleField[] = []) => fields.filter((f) => f.label.trim() || f.value.trim()).slice(0, MAX_TITLE_FIELDS);

/** How tall the rows of the logo and your own fields are, mm. */
function ownHeight(info: SheetInfo): number {
  const n = shownFields(info.fields).length + (info.logo ? 1 : 0);
  return n ? (info.logo ? OWN.logo : OWN.h) + (Math.ceil(n / OWN.across) - 1) * OWN.h : 0;
}

/** The logo and your own fields, four to a row from the block's top left corner. The last cell of a row takes what is left. */
function ownCells(block: Box, info: SheetInfo): TitleCell[] {
  type Item = { logo: TitleLogo } | { field: TitleField; i: number };
  const items: Item[] = [...(info.logo ? [{ logo: info.logo }] : []), ...shownFields(info.fields).map((field, i) => ({ field, i }))];
  const cells: TitleCell[] = [];
  let y = block.y;
  for (let r = 0; r * OWN.across < items.length; r++) {
    const row = items.slice(r * OWN.across, (r + 1) * OWN.across);
    const h = r === 0 && info.logo ? OWN.logo : OWN.h;
    const each = block.w / OWN.across;
    row.forEach((item, c) => {
      const x = block.x + c * each;
      const w = c === row.length - 1 ? block.x + block.w - x : each;
      if ("logo" in item) {
        // The picture keeps its shape, 1 mm clear of the cell's lines.
        const k = Math.min((w - 2) / item.logo.w, (h - 2) / item.logo.h);
        const box: Box = { x: x + (w - item.logo.w * k) / 2, y: y + (h - item.logo.h * k) / 2, w: item.logo.w * k, h: item.logo.h * k };
        cells.push({ key: "logo", label: "Logo", value: "", size: TEXT.value, x, y, w, h, image: { logo: item.logo, box } });
      } else {
        const value = item.field.value.trim();
        cells.push({ key: `field-${item.i}`, label: item.field.label.trim(), value, size: fitted(value, w, TEXT.value), x, y, w, h });
      }
    });
    y += h;
  }
  return cells;
}

/** The title block's cells, laid out from the block's top left corner. */
function titleCells(sheet: DrawingSheet, block: Box, rows: Row[], info: SheetInfo): TitleCell[] {
  const values: Record<TitleKey, string> = {
    title: sheet.title.title ?? "",
    author: sheet.title.author ?? "",
    approved: sheet.title.approved ?? "",
    type: sheet.title.type ?? "",
    status: sheet.title.status ?? "",
    number: sheet.title.number ?? "",
    revision: sheet.title.revision ?? "",
    date: sheet.title.date ?? "",
    scale: scaleLabel(sheet.scale),
    size: sizeName(sheet.size),
    sheet: `${info.index ?? 1}/${info.count ?? 1}`,
    units: "mm",
    projection: "",
  };
  const cells: TitleCell[] = [];
  let y = block.y;
  rows.forEach((row, r) => {
    // A cell from the row above that spans into this one takes its width off the left.
    let x = block.x + (r > 0 ? rows[r - 1]!.cells.filter((c) => (c[2] ?? 1) > 1).reduce((s, c) => s + c[1], 0) : 0);
    for (const [key, w, span = 1] of row.cells) {
      const h = rows.slice(r, r + span).reduce((s, x) => s + x.h, 0);
      const value = values[key];
      const size = fitted(value, w, key === "title" ? TEXT.title : TEXT.value);
      const cell: TitleCell = { key, label: LABELS[sheet.standard][key], value, size, x, y, w, h };
      if (EDITABLE.has(key)) cell.edit = key as keyof TitleBlock;
      cells.push(cell);
      x += w;
    }
    y += row.h;
  });
  return cells;
}

export function sheetLayout(sheet: DrawingSheet, info: SheetInfo = {}): SheetLayout {
  const page = sheetBox(sheet);
  const m = margins(sheet.standard);
  const frame: Box = { x: m.left, y: m.top, w: page.w - m.left - m.right, h: page.h - m.top - m.bottom };
  const iso = sheet.standard === "iso";

  const ticks: Stroke[] = [];
  const labels: ZoneLabel[] = [];
  const centring: Stroke[] = [];
  if (sheet.border) {
    const cols = zones(frame.w);
    const rows = zones(frame.h);
    const top = frame.y - STRIP;
    const bottom = frame.y + frame.h;
    const left = frame.x - STRIP;
    const right = frame.x + frame.w;
    for (let i = 0; i <= cols; i++) {
      const x = frame.x + (frame.w * i) / cols;
      if (i > 0 && i < cols) {
        ticks.push({ x1: x, y1: top, x2: x, y2: frame.y }, { x1: x, y1: bottom, x2: x, y2: bottom + STRIP });
      }
      if (i < cols) {
        // ISO numbers its zones from the left; ASME from the right, where the title block is.
        const text = String(iso ? i + 1 : cols - i);
        const mid = x + frame.w / cols / 2;
        labels.push({ text, x: mid, y: top + STRIP / 2 }, { text, x: mid, y: bottom + STRIP / 2 });
      }
    }
    for (let j = 0; j <= rows; j++) {
      const y = frame.y + (frame.h * j) / rows;
      if (j > 0 && j < rows) {
        ticks.push({ x1: left, y1: y, x2: frame.x, y2: y }, { x1: right, y1: y, x2: right + STRIP, y2: y });
      }
      if (j < rows) {
        // ISO letters run down from the top; ASME up from the bottom.
        const text = LETTERS[(iso ? j : rows - 1 - j) % LETTERS.length]!;
        const mid = y + frame.h / rows / 2;
        labels.push({ text, x: left + STRIP / 2, y: mid }, { text, x: right + STRIP / 2, y: mid });
      }
    }
    const cx = frame.x + frame.w / 2;
    const cy = frame.y + frame.h / 2;
    centring.push(
      { x1: cx, y1: top, x2: cx, y2: frame.y + STRIP },
      { x1: cx, y1: bottom - STRIP, x2: cx, y2: bottom + STRIP },
      { x1: left, y1: cy, x2: frame.x + STRIP, y2: cy },
      { x1: right - STRIP, y1: cy, x2: right + STRIP, y2: cy },
    );
  }

  const rows = iso ? ISO_ROWS : ASME_ROWS;
  const w = rows[0]!.cells.reduce((s, c) => s + c[1], 0);
  const own = ownHeight(info);
  const h = rows.reduce((s, r) => s + r.h, 0) + own;
  const block: Box = { x: frame.x + frame.w - w, y: frame.y + frame.h - h, w, h };
  const cells = [...ownCells(block, info), ...titleCells(sheet, { ...block, y: block.y + own, h: h - own }, rows, info)];
  return { page, frame, border: sheet.border, ticks, labels, centring, block, cells, angle: iso ? "first" : "third" };
}

/** Today as the title block writes it: 2026-11-22. */
export function today(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
