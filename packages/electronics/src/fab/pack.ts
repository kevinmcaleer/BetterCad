import { boardPads, boardSize } from "../board";
import type { ElectronicsDesign } from "../model";
import { netlist } from "../nets";
import { copperOf } from "../pcb/copper";
import { checkBoard } from "../pcb/drc";
import { pourFills } from "../pcb/pour";
import { panelFiles, type Panel } from "./panel";
import { drillFiles, type DrillTool } from "./drill";
import { gerberFiles, notesFile, pourClashes, type GerberLayer } from "./gerber";
import { layerName } from "../pcb/stack";
import data from "./houses.json";
import { bom, placeList, type Bom, type BomRow, type PlaceRow } from "./parts";

export { pinOnes, type PinOne } from "./parts";

/**
 * The order pack (#660): everything one board house wants for one board, named its way, with a checklist of what
 * would make the order go wrong. Rows and text only; the app zips them and writes spreadsheets.
 */
export type BomKey = "line" | "qty" | "refs" | "value" | "footprint" | "description" | "mounting" | "manufacturer" | "mpn" | "lcsc";
export type PlaceKey = "ref" | "value" | "footprint" | "x" | "y" | "side" | "rotation";

export interface House {
  id: string;
  name: string;
  /** The house's own site, to open and upload to. Nothing is uploaded for you. */
  site: string;
  source: string[];
  checked: string;
  names: { gerbers: string; bom: string; place: string };
  bom: { key: BomKey; heading: string }[];
  place: { key: PlaceKey; heading: string }[];
  sides: { top: string; bottom: string };
  /** Whether through-hole parts go in the pick and place list. */
  placeThru: boolean;
  /** Part numbers an assembly order cannot do without. */
  needs: ("lcsc" | "mpn")[];
  notes: string[];
}

export const HOUSES = data.houses as House[];
export const houseOf = (id: string): House => HOUSES.find((h) => h.id === id) ?? HOUSES[HOUSES.length - 1]!;

const MOUNTING = { smd: "Surface mount", thru: "Thru-hole", hybrid: "Hybrid", none: "" } as const;

/** A table: a row of headings, then rows of cells. Numbers stay numbers, for a spreadsheet. */
export type Table = (string | number)[][];

export function bomTable(house: House, rows: BomRow[]): Table {
  const cell = (r: BomRow, key: BomKey): string | number =>
    key === "refs" ? r.refs.join(",") : key === "mounting" ? MOUNTING[r.mounting] : key === "line" || key === "qty" ? r[key] : r[key];
  return [house.bom.map((c) => c.heading), ...rows.map((r) => house.bom.map((c) => cell(r, c.key)))];
}

export function placeTable(house: House, rows: PlaceRow[]): Table {
  const cell = (r: PlaceRow, key: PlaceKey): string | number => (key === "side" ? house.sides[r.side] : r[key]);
  return [house.place.map((c) => c.heading), ...rows.map((r) => house.place.map((c) => cell(r, c.key)))];
}

/** A table as CSV: commas, quotes round any cell that needs them, lines ended the way spreadsheets expect. */
export function csv(table: Table): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return table.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** The file extension each layer is known by. */
const EXT: Record<Exclude<GerberLayer, `copper-in${number}`>, string> = {
  "copper-top": "GTL",
  "copper-bottom": "GBL",
  "mask-top": "GTS",
  "mask-bottom": "GBS",
  "paste-top": "GTP",
  "paste-bottom": "GBP",
  "silk-top": "GTO",
  "silk-bottom": "GBO",
  edge: "GKO",
};

/** An inner layer is G1, G2 and so on, the Protel way. */
const extOf = (l: GerberLayer): string => (l in EXT ? EXT[l as keyof typeof EXT] : `G${l.slice(9)}`);

/** A name safe in a file name on any system. */
export const fileBase = (name: string): string =>
  name
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "board";

export interface Check {
  id: "board-check" | "outline" | "pours" | "pour-clash" | "part-numbers" | "placed" | "parts" | "panel";
  ok: boolean;
  /** Stops the export: the files would be wrong. The rest are warnings to read. */
  blocks: boolean;
  text: string;
}

export interface Pack {
  house: House;
  /** What an order form asks for. */
  facts: { width: number; height: number; thickness: number; layers: number; minTrack: number | null; minGap: number; minHole: number | null };
  checks: Check[];
  /** Files inside the Gerber zip, in the order a viewer stacks them. */
  gerbers: { name: string; layer: GerberLayer | "drill-plated" | "drill-bare" | "drill-span" | "vcut" | "notes"; text: string }[];
  /** The panel the files make, when there is one (#662): its size and how many boards. */
  panel: { w: number; h: number; boards: number; join: Panel["join"] } | null;
  zipName: string;
  bom: Bom;
  bomTable: Table;
  bomName: string;
  place: PlaceRow[];
  placeTable: Table;
  placeName: string;
  tools: DrillTool[];
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const list = (refs: string[]) => (refs.length > 6 ? `${refs.slice(0, 6).join(", ")} and ${refs.length - 6} more` : refs.join(", "));

/** The order pack for a board house, or null when there is no board. `name` is the model's name. */
export function orderPack(d: ElectronicsDesign, houseId: string, name: string, panel?: Panel | null): Pack | null {
  const board = d.board;
  if (!board) return null;
  const house = houseOf(houseId);
  const nl = netlist(d);
  const pads = boardPads(d, nl);
  const copper = copperOf(d, pads);
  const base = fileBase(name);
  const one = drillFiles(d, nl)!;
  const many = panel && panel.rows * panel.cols > 1 ? panelFiles(board, panel, gerberFiles(d, nl), one, board.copperLayers) : null;
  const drills = many?.drills ?? one;
  const gerbers: Pack["gerbers"] = (many?.gerbers ?? gerberFiles(d, nl)).map((f) => ({ name: `${base}.${extOf(f.layer)}`, layer: f.layer, text: f.text }));
  if (many?.vcut) gerbers.push({ name: `${base}-VCUT.gbr`, layer: "vcut", text: many.vcut });
  if (drills.tools.some((t) => t.plated && !t.span)) gerbers.push({ name: `${base}-PTH.DRL`, layer: "drill-plated", text: drills.plated });
  if (drills.tools.some((t) => !t.plated)) gerbers.push({ name: `${base}-NPTH.DRL`, layer: "drill-bare", text: drills.bare });
  for (const s of drills.spans) gerbers.push({ name: `${base}-L${s.from}-L${s.to}.DRL`, layer: "drill-span", text: s.text });
  // The notes go with one board, not stepped across a panel: they are for reading, not making.
  const notes = notesFile(board);
  if (notes) gerbers.push({ name: `${base}-Notes.gbr`, layer: "notes", text: notes });

  const parts = bom(d);
  const place = placeList(d, { thru: house.placeThru });
  const results = checkBoard(d).filter((r) => !r.waived);
  const errors = results.filter((r) => r.level === "error").length;
  const warnings = results.filter((r) => r.level === "warning").length;
  const clashes = pourClashes(d, pads, copper);
  const empty = pourFills(d, pads, copper).filter((f) => f.area === 0).length;
  const size = boardSize(board);
  const placed = new Set(board.placements.map((p) => p.part));
  const unplaced = parts.rows.flatMap((r) => r.refs.filter((_, i) => !placed.has(r.parts[i]!)));
  const missing = [...new Set(house.needs.flatMap((k) => (k === "lcsc" ? parts.noLcsc : parts.noMpn)))];

  const square = board.outline.length === 4 && !board.outline.some((c) => c.bulge) && !board.cutouts?.length;
  const checks: Check[] = [
    ...(many && panel
      ? [
          {
            id: "panel" as const,
            ok: panel.join === "tabs" || square,
            blocks: false,
            text:
              panel.join === "vcut" && !square
                ? "V-cuts run in straight lines right across the panel, and this board is not a plain rectangle. Hold it with tabs instead."
                : `${count(many.layout.offsets.length, "board", "boards")} on a ${many.layout.w} × ${many.layout.h} mm panel. Tell the board house it is a panel you made, and how the boards are joined. The pick and place list is for one board.`,
          },
        ]
      : []),
    {
      id: "board-check",
      ok: errors === 0,
      blocks: false,
      text: errors
        ? `The board check has ${count(errors, "error", "errors")}. Open Board check and fix or waive them.`
        : warnings
          ? `The board check has no errors, and ${count(warnings, "warning", "warnings")} to read.`
          : "The board check is clean.",
    },
    { id: "outline", ok: board.outline.length > 2, blocks: true, text: board.outline.length > 2 ? "The outline is closed." : "The board has no outline." },
    {
      id: "pours",
      ok: empty === 0,
      blocks: false,
      text: !board.pours.length
        ? "No pours to fill."
        : empty
          ? `${count(empty, "pour fills", "pours fill")} nothing.`
          : `${count(board.pours.length, "pour is", "pours are")} filled.`,
    },
    ...(clashes.length
      ? [
          {
            id: "pour-clash" as const,
            ok: false,
            blocks: true,
            text: `Two pours on ${layerName(clashes[0]!.side).toLowerCase()}, on ${clashes[0]!.a} and ${clashes[0]!.b}, run into each other. Redraw one so they do not overlap; the files cannot show them truly as they are.`,
          },
        ]
      : []),
    {
      id: "parts",
      ok: parts.rows.length > 0,
      blocks: false,
      text: parts.rows.length
        ? `${count(
            parts.rows.reduce((n, r) => n + r.qty, 0),
            "part",
            "parts",
          )} on ${count(parts.rows.length, "row", "rows")} of the parts list.`
        : "No parts to list.",
    },
    ...(unplaced.length ? [{ id: "placed" as const, ok: false, blocks: false, text: `Not on the board yet: ${list(unplaced)}.` }] : []),
    ...(house.needs.length
      ? [
          {
            id: "part-numbers" as const,
            ok: missing.length === 0,
            blocks: false,
            text: missing.length
              ? `No part number for assembly: ${list(missing)}. Add them in the parts list, or order the bare board.`
              : "Every part has a part number.",
          },
        ]
      : []),
  ];

  const tracks = board.tracks.map((t) => t.width);
  const drilled = drills.holes.map((h) => h.d);
  return {
    house,
    facts: {
      width: Math.round((many ? many.layout.w : size.w) * 100) / 100,
      height: Math.round((many ? many.layout.h : size.h) * 100) / 100,
      thickness: board.thickness,
      layers: board.copperLayers,
      minTrack: tracks.length ? Math.min(...tracks) : null,
      minGap: Math.min(board.rules.clearance, ...board.classes.map((c) => c.clearance)),
      minHole: drilled.length ? Math.min(...drilled) : null,
    },
    checks,
    gerbers,
    panel: many && panel ? { w: many.layout.w, h: many.layout.h, boards: many.layout.offsets.length, join: panel.join } : null,
    zipName: house.names.gerbers.replace("{name}", base),
    bom: parts,
    bomTable: bomTable(house, parts.rows),
    bomName: house.names.bom.replace("{name}", base),
    place,
    placeTable: placeTable(house, place),
    placeName: house.names.place.replace("{name}", base),
    tools: drills.tools,
  };
}
