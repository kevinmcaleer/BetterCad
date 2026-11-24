import { zip } from "@bettercad/kernel/zip";
import { csv, type Pack } from "@bettercad/electronics/fab/pack";
import type { OutFile } from "../files/fileStore";
import { xlsx } from "./xlsx";

export type SheetFormat = "csv" | "xlsx";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const buffer = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const text = (s: string) => buffer(new TextEncoder().encode(s));

/**
 * The files of an order pack (#660), ready to save: the Gerbers and drill files in a zip of their own, which is what
 * a board house's upload takes, then the parts list and the pick and place list when the board has parts to fit.
 */
export function orderFiles(pack: Pack, format: SheetFormat): OutFile[] {
  const enc = new TextEncoder();
  const out: OutFile[] = [
    { name: pack.zipName, mime: "application/zip", data: Promise.resolve(buffer(zip(pack.gerbers.map((g) => ({ name: g.name, data: enc.encode(g.text) }))))) },
  ];
  const sheet = (name: string, table: Pack["bomTable"], title: string): OutFile =>
    format === "csv"
      ? { name: `${name}.csv`, mime: "text/csv", data: Promise.resolve(text(csv(table))) }
      : { name: `${name}.xlsx`, mime: XLSX_MIME, data: Promise.resolve(buffer(xlsx(table, title))) };
  if (pack.bom.rows.length) out.push(sheet(pack.bomName, pack.bomTable, "BOM"));
  if (pack.place.length) out.push(sheet(pack.placeName, pack.placeTable, "Positions"));
  return out;
}
